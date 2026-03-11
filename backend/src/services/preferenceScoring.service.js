/**
 * preferenceScoring.service.js
 *
 * CRM Restructure: Weighted partial scoring with tiered preferences.
 * Replaces percentile-based tier logic.
 *
 * Scoring (per lead):
 *   Title match:      Primary +50, Secondary +25, Tertiary +10
 *   Industry match:   Primary +40, Secondary +20, Tertiary +10
 *   Company Size:     Primary +20, Secondary +10, Tertiary +0
 * Total = preference_score. Tier = highest tier matched (Primary > Secondary > Tertiary).
 *
 * AI High Priority rule:
 *   My Contacts: only Primary tier (profile-matched through industry) gets is_priority = true.
 *   Secondary and Tertiary do not; tiers remain dynamic for dashboard/counts.
 */

import pool from '../db.js';
import { INDUSTRY_KEYWORDS, TIER_INDUSTRY_GROUPS } from '../config/industries.js';
import {
  resolveLeadTopLevel,
  resolveLeadSubIndustry,
  getTopLevelFromIndustryLabel,
  getSubCategoryFromIndustryLabel,
  getTierFromHierarchy,
} from './industryHierarchy.service.js';
import { getIndustryList } from './industryList.service.js';
import config from '../config/index.js';

/** Build map: normalised(industry label or sub_category) -> top_level_industry, so Settings labels (e.g. "Restaurants") match lead resolved industry (e.g. "Food & Beverage Services"). */
async function getIndustryLabelToTopLevelMap() {
  const list = await getIndustryList();
  const map = new Map();
  for (const item of list) {
    const top = item.top_level_industry || item.name || '';
    if (top) {
      map.set(normalise(item.name || ''), top);
      map.set(normalise(item.label || ''), top);
      if (item.sub_category) map.set(normalise(item.sub_category), top);
      map.set(normalise(top), top);
    }
  }
  return map;
}

// ── helpers ────────────────────────────────────────────────────────────────

function normalise(str = '') {
  return str.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenOverlap(a = '', b = '') {
  const tokA = normalise(a).split(' ').filter(Boolean);
  const tokB = new Set(normalise(b).split(' ').filter(Boolean));
  if (!tokA.length) return 0;
  const matches = tokA.filter(t => tokB.has(t)).length;
  return matches / tokA.length;
}

/** Given a lead's company+title text, resolve top-level industry via INDUSTRY_KEYWORDS. */
function resolveIndustry(company = '', title = '') {
  const text = normalise(`${company} ${title}`);
  for (const [industry, keywords] of Object.entries(INDUSTRY_KEYWORDS || {})) {
    if (keywords.some(k => text.includes(normalise(k)))) return industry;
  }
  return null;
}

/** Check if a value matches any in a list (normalised contains or equality). */
function matchesAny(leadValue, list) {
  if (!list || !Array.isArray(list) || list.length === 0) return null;
  const nv = normalise(String(leadValue || ''));
  for (const item of list) {
    const ni = normalise(String(item || ''));
    if (ni && (nv === ni || nv.includes(ni) || ni.includes(nv) || tokenOverlap(ni, nv) >= 0.5)) {
      return true;
    }
  }
  return false;
}

/** Which tier does this value match? Returns 'primary'|'secondary'|'tertiary'|null. */
function tierMatched(leadValue, tiers) {
  if (!tiers || !leadValue) return null;
  const p = tiers.primary && (tiers.primary.titles || tiers.primary.industries || tiers.primary.company_sizes);
  const s = tiers.secondary && (tiers.secondary.titles || tiers.secondary.industries || tiers.secondary.company_sizes);
  const t = tiers.tertiary && (tiers.tertiary.titles || tiers.tertiary.industries || tiers.tertiary.company_sizes);

  const inList = (arr) => Array.isArray(arr) && arr.some(item => matchesAny(leadValue, [item]));

  if (p) {
    const primaryLists = [p.titles, p.industries, p.company_sizes].filter(Boolean);
    for (const arr of primaryLists) {
      if (inList(arr)) return 'primary';
    }
  }
  if (s) {
    const secondaryLists = [s.titles, s.industries, s.company_sizes].filter(Boolean);
    for (const arr of secondaryLists) {
      if (inList(arr)) return 'secondary';
    }
  }
  if (t) {
    const tertiaryLists = [t.titles, t.industries, t.company_sizes].filter(Boolean);
    for (const arr of tertiaryLists) {
      if (inList(arr)) return 'tertiary';
    }
  }
  return null;
}

/** Score for a single dimension: which tier the lead value matched. */
const TIER_SCORE = { primary: { title: 50, industry: 40, company_size: 20 }, secondary: { title: 25, industry: 20, company_size: 10 }, tertiary: { title: 10, industry: 10, company_size: 0 } };

function scoreTitleMatch(leadTitle, tiers) {
  if (!tiers || !leadTitle) return { score: 0, tier: null };
  const primaryTitles = tiers.primary?.titles || [];
  const secondaryTitles = tiers.secondary?.titles || [];
  const tertiaryTitles = tiers.tertiary?.titles || [];
  const nTitle = normalise(leadTitle);
  for (const t of primaryTitles) {
    if (matchesAny(leadTitle, [t])) return { score: TIER_SCORE.primary.title, tier: 'primary' };
  }
  for (const t of secondaryTitles) {
    if (matchesAny(leadTitle, [t])) return { score: TIER_SCORE.secondary.title, tier: 'secondary' };
  }
  for (const t of tertiaryTitles) {
    if (matchesAny(leadTitle, [t])) return { score: TIER_SCORE.tertiary.title, tier: 'tertiary' };
  }
  return { score: 0, tier: null };
}

/**
 * Match lead industry candidates against preference industry list.
 * @param {string[]} leadIndustryCandidates - e.g. [lead.industry, resolveIndustry(company, title)]
 * @param {object} tiers - preference_tiers
 * @param {Map<string,string>} [industryLabelToTopLevel] - optional map: normalised(label) -> top_level_industry (so "Restaurants" matches "Food & Beverage Services")
 */
function scoreIndustryMatch(leadIndustry, tiers, industryLabelToTopLevel = null) {
  if (!tiers || !leadIndustry) return { score: 0, tier: null };
  const candidates = Array.isArray(leadIndustry)
    ? leadIndustry.filter(Boolean)
    : [leadIndustry].filter(Boolean);
  if (candidates.length === 0) return { score: 0, tier: null };

  const expandPrefIndustry = (prefLabel) => {
    const list = [prefLabel];
    if (industryLabelToTopLevel && prefLabel) {
      const top = industryLabelToTopLevel.get(normalise(String(prefLabel)));
      if (top && top !== prefLabel) list.push(top);
    }
    return list;
  };

  const primaryIndustries = tiers.primary?.industries || [];
  const secondaryIndustries = tiers.secondary?.industries || [];
  const tertiaryIndustries = tiers.tertiary?.industries || [];

  for (const i of primaryIndustries) {
    const toMatch = expandPrefIndustry(i);
    if (candidates.some((c) => toMatch.some((m) => matchesAny(c, [m])))) {
      return { score: TIER_SCORE.primary.industry, tier: 'primary' };
    }
  }
  for (const i of secondaryIndustries) {
    const toMatch = expandPrefIndustry(i);
    if (candidates.some((c) => toMatch.some((m) => matchesAny(c, [m])))) {
      return { score: TIER_SCORE.secondary.industry, tier: 'secondary' };
    }
  }
  for (const i of tertiaryIndustries) {
    const toMatch = expandPrefIndustry(i);
    if (candidates.some((c) => toMatch.some((m) => matchesAny(c, [m])))) {
      return { score: TIER_SCORE.tertiary.industry, tier: 'tertiary' };
    }
  }
  return { score: 0, tier: null };
}

function scoreCompanySizeMatch(leadCompanySize, tiers) {
  if (!tiers || !leadCompanySize) return { score: 0, tier: null };
  const primarySizes = tiers.primary?.company_sizes || [];
  const secondarySizes = tiers.secondary?.company_sizes || [];
  const tertiarySizes = tiers.tertiary?.company_sizes || [];
  const n = normalise(String(leadCompanySize));
  for (const s of primarySizes) {
    if (matchesAny(leadCompanySize, [s])) return { score: TIER_SCORE.primary.company_size, tier: 'primary' };
  }
  for (const s of secondarySizes) {
    if (matchesAny(leadCompanySize, [s])) return { score: TIER_SCORE.secondary.company_size, tier: 'secondary' };
  }
  for (const s of tertiarySizes) {
    if (matchesAny(leadCompanySize, [s])) return { score: TIER_SCORE.tertiary.company_size, tier: 'tertiary' };
  }
  return { score: 0, tier: null };
}

/** Highest tier from a list (primary > secondary > tertiary). */
function highestTier(tiers) {
  if (!tiers || tiers.length === 0) return null;
  if (tiers.includes('primary')) return 'primary';
  if (tiers.includes('secondary')) return 'secondary';
  if (tiers.includes('tertiary')) return 'tertiary';
  return null;
}

// ── main scoring (new tiered model) ────────────────────────────────────────

/**
 * Calculate preference_score and preference_tier using tiered preferences only.
 * Degree does NOT influence tier. Tier = highest matched (Primary > Secondary > Tertiary).
 *
 * @param {object} lead – { title, company, location, company_size?, industry? } (DB row or plain object)
 * @param {object} prefs – preference_settings row (with preference_tiers JSONB)
 * @param {Map<string,string>} [industryLabelToTopLevel] – optional map so Settings industry labels (e.g. sub-categories) match resolved top-level
 * @returns {{ score: number, tier: string|null }}
 */
export function calculateScore(lead, prefs, industryLabelToTopLevel = null) {
  const tiers = prefs?.preference_tiers || null;
  if (!tiers || (typeof tiers !== 'object')) {
    return { score: 0, tier: null };
  }

  const leadTitle = lead.title || '';
  const industryFromLead = lead.industry || '';
  const industryFromKeywords = resolveIndustry(lead.company || '', lead.title || '');
  const leadIndustryCandidates = [industryFromLead, industryFromKeywords]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  const leadCompanySize = lead.company_size || null;

  const titleResult = scoreTitleMatch(leadTitle, tiers);
  const industryResult = scoreIndustryMatch(leadIndustryCandidates, tiers, industryLabelToTopLevel);
  const companySizeResult = scoreCompanySizeMatch(leadCompanySize, tiers);

  const score = titleResult.score + industryResult.score + companySizeResult.score;
  const matchedTiers = [titleResult.tier, industryResult.tier, companySizeResult.tier].filter(Boolean);
  const tier = highestTier(matchedTiers);

  return { score: Math.round(score), tier };
}

/**
 * My Contacts (is_priority): only Primary tier — highly prioritized, profile-matched through industry codes.
 * Tiers (Primary/Secondary/Tertiary) stay dynamic for all leads; My Contacts lists only Primary so it is not dominated by secondary.
 */
export function applyPriorityRule(score, tier, prefs, overrideIsPriority = null) {
  let isPriority = tier === 'primary';
  if (overrideIsPriority !== null) {
    isPriority = overrideIsPriority;
  }
  const reviewStatus = isPriority ? 'approved' : 'to_be_reviewed';
  return { isPriority, reviewStatus };
}

// ── profile-based tiering (default profile or saved LinkedIn URL) ──────────

/** Score for profile-based tier so dashboard sort is sensible (primary > secondary > tertiary). */
const PROFILE_TIER_SCORE = { primary: 100, secondary: 50, tertiary: 10 };

/**
 * Resolve user profile for tier comparison: either from prefs (URL + profile_meta) or default profile.
 * Returns { userTopLevel, userSub } or null if resolution fails.
 */
async function getProfileForTiering(prefs) {
  const defaultProfile = config.defaultProfile || {};
  const profileUrl = prefs?.linkedin_profile_url || defaultProfile.linkedinUrl;
  const profileMeta = prefs?.profile_meta && typeof prefs.profile_meta === 'object' ? prefs.profile_meta : {};

  let industryLabel = profileMeta.industry || profileMeta.title || null;
  if (industryLabel && typeof industryLabel !== 'string') industryLabel = null;

  if (!industryLabel && profileUrl) {
    try {
      const profileEnrichment = (await import('./profileEnrichment.service.js')).default;
      const enriched = await profileEnrichment.enrichProfileFromUrl(profileUrl);
      if (enriched && enriched.industry) industryLabel = enriched.industry;
    } catch (_) {
      // ignore
    }
  }

  if (!industryLabel) {
    industryLabel = defaultProfile.industry || null;
  }
  if (!industryLabel) return null;

  let userTopLevel = await getTopLevelFromIndustryLabel(industryLabel);
  if (!userTopLevel && defaultProfile.industry) {
    userTopLevel = await getTopLevelFromIndustryLabel(defaultProfile.industry);
  }
  if (!userTopLevel) return null;
  const userSub = defaultProfile.subIndustry ?? (await getSubCategoryFromIndustryLabel(industryLabel)) ?? null;
  return { userTopLevel, userSub };
}

/**
 * Get default tier for a lead from profile-based industry groups (no manual tier lists).
 * Primary = industries related to user profile (e.g. chemical CEO → manufacturing, chemicals, marketing).
 * Secondary = adjacent industries (e.g. IT, tech, education).
 * Tertiary = remaining. All leads (from any source) get one of the three tiers.
 */
function getProfileTierFromGroups(userTopLevel, leadTopLevel) {
  if (!leadTopLevel) return 'tertiary';
  const groups = TIER_INDUSTRY_GROUPS[userTopLevel];
  if (!groups) {
    // No group defined: same top-level = primary, else tertiary (fallback to strict hierarchy)
    const sameTop = normalise(String(userTopLevel)) === normalise(String(leadTopLevel));
    return sameTop ? 'primary' : 'tertiary';
  }
  const nLead = normalise(String(leadTopLevel));
  const primarySet = new Set((groups.primary || []).map((s) => normalise(s)));
  const secondarySet = new Set((groups.secondary || []).map((s) => normalise(s)));
  if (primarySet.has(nLead)) return 'primary';
  if (secondarySet.has(nLead)) return 'secondary';
  return 'tertiary';
}

/**
 * Calculate score and tier for a lead using profile-based industry groups (no manual tier lists).
 * All leads from My Contacts (any source) are tiered: primary = profile-related industries, secondary = adjacent, tertiary = rest.
 */
function calculateScoreFromProfile(lead, userTopLevel, userSub) {
  const leadTopLevel = resolveLeadTopLevel(lead.company || '', lead.title || '');
  const tier = getProfileTierFromGroups(userTopLevel, leadTopLevel);
  const score = (PROFILE_TIER_SCORE[tier] ?? PROFILE_TIER_SCORE.tertiary) + defaultQualityScore(lead);
  return { score: Math.round(score), tier };
}

// ── database helpers ───────────────────────────────────────────────────────

export async function loadPreferences() {
  try {
    const res = await pool.query('SELECT * FROM preference_settings WHERE id = 1');
    return res.rows[0] || null;
  } catch {
    return null;
  }
}

/** Save preference settings (upsert row 1). Supports legacy columns and preference_tiers. */
export async function savePreferences(data) {
  const {
    linkedin_profile_url,
    preference_tiers,
    contacts_min_score,
    secondary_priority_threshold,
    profile_meta,
    preference_active,
    // Legacy
    preferred_companies,
    preferred_industries,
    preferred_titles,
    preferred_locations,
    niche_keywords,
    primary_threshold,
    secondary_threshold,
    auto_approval_threshold,
  } = data;

  const tiersJson = preference_tiers != null
    ? JSON.stringify(preference_tiers)
    : (data.preference_tiers ? JSON.stringify(data.preference_tiers) : null);

  await pool.query(`
    INSERT INTO preference_settings (
      id, linkedin_profile_url,
      preference_tiers, secondary_priority_threshold, contacts_min_score,
      profile_meta, preference_active,
      preferred_companies, preferred_industries, preferred_titles,
      preferred_locations, niche_keywords,
      primary_threshold, secondary_threshold, auto_approval_threshold,
      updated_at
    ) VALUES (
      1, $1, $2::jsonb, $3, $4, $5::jsonb, $6,
      $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      linkedin_profile_url         = COALESCE(EXCLUDED.linkedin_profile_url, preference_settings.linkedin_profile_url),
      preference_tiers              = COALESCE(EXCLUDED.preference_tiers, preference_settings.preference_tiers),
      secondary_priority_threshold   = COALESCE(EXCLUDED.secondary_priority_threshold, preference_settings.secondary_priority_threshold),
      contacts_min_score             = COALESCE(EXCLUDED.contacts_min_score, preference_settings.contacts_min_score),
      profile_meta                  = COALESCE(EXCLUDED.profile_meta, preference_settings.profile_meta),
      preference_active              = COALESCE(EXCLUDED.preference_active, preference_settings.preference_active),
      preferred_companies           = COALESCE(EXCLUDED.preferred_companies, preference_settings.preferred_companies),
      preferred_industries          = COALESCE(EXCLUDED.preferred_industries, preference_settings.preferred_industries),
      preferred_titles               = COALESCE(EXCLUDED.preferred_titles, preference_settings.preferred_titles),
      preferred_locations           = COALESCE(EXCLUDED.preferred_locations, preference_settings.preferred_locations),
      niche_keywords                = COALESCE(EXCLUDED.niche_keywords, preference_settings.niche_keywords),
      primary_threshold             = COALESCE(EXCLUDED.primary_threshold, preference_settings.primary_threshold),
      secondary_threshold           = COALESCE(EXCLUDED.secondary_threshold, preference_settings.secondary_threshold),
      auto_approval_threshold       = COALESCE(EXCLUDED.auto_approval_threshold, preference_settings.auto_approval_threshold),
      updated_at                    = NOW()
  `, [
    linkedin_profile_url ?? null,
    tiersJson,
    secondary_priority_threshold ?? 70,
    contacts_min_score ?? 70,
    JSON.stringify(profile_meta || {}),
    preference_active ?? false,
    preferred_companies ?? null,
    JSON.stringify(preferred_industries || []),
    JSON.stringify(preferred_titles || []),
    preferred_locations ?? null,
    niche_keywords ?? null,
    primary_threshold ?? 120,
    secondary_threshold ?? 60,
    auto_approval_threshold ?? 150,
  ]);
}

/**
 * Default quality score for a lead when no preference_tiers are set.
 * Based only on profile completeness (title, company, email, phone). Connection degree is NOT used.
 */
function defaultQualityScore(lead) {
  let s = 0;
  if (lead.title && String(lead.title).trim()) s += 30;
  if (lead.company && String(lead.company).trim()) s += 30;
  if (lead.email && String(lead.email).trim()) s += 20;
  if (lead.phone && String(lead.phone).trim()) s += 20;
  return s;
}

/**
 * Recalculate scores for all leads (any source: My Contacts, search, import).
 * - When preference_active is ON (Active): use manual Primary/Secondary/Tertiary lists; leads matching those lists get that tier; no match → tertiary.
 * - When preference_active is OFF (Paused): use profile-based tiering (Your profile industry); all leads get primary/secondary/tertiary from profile industry groups.
 * - manual_tier on a lead overrides computed preference_tier for display/filters.
 */
export async function recalculateAllScores() {
  const prefs = await loadPreferences();

  const tiers = prefs?.preference_tiers && typeof prefs.preference_tiers === 'object' ? prefs.preference_tiers : null;
  const hasTierCriteria = tiers && (
    (tiers.primary && (tiers.primary.titles?.length || tiers.primary.industries?.length || tiers.primary.company_sizes?.length)) ||
    (tiers.secondary && (tiers.secondary.titles?.length || tiers.secondary.industries?.length || tiers.secondary.company_sizes?.length)) ||
    (tiers.tertiary && (tiers.tertiary.titles?.length || tiers.tertiary.industries?.length || tiers.tertiary.company_sizes?.length))
  );
  const preferenceActive = Boolean(prefs?.preference_active);
  const useManualTiers = preferenceActive && hasTierCriteria;

  // When Active + manual tiers: map Settings industry labels to top-level for matching
  let industryLabelToTopLevel = null;
  if (useManualTiers) {
    try {
      industryLabelToTopLevel = await getIndustryLabelToTopLevelMap();
    } catch (err) {
      console.warn('[scoring] Industry label map failed, using direct match only:', err?.message);
    }
  }

  // When Paused (or Active but no manual tiers): use profile-based tiering so all leads get a tier from your profile industry
  let profileForTier = null;
  if (!useManualTiers) {
    try {
      profileForTier = await getProfileForTiering(prefs);
    } catch (err) {
      console.warn('[scoring] Profile for tiering failed, using fallback:', err?.message);
    }
  }

  let offset = 0;
  const PAGE = 1000;
  const allUpdates = [];

  while (true) {
    const { rows } = await pool.query(
      `SELECT id, company, title, location, connection_degree, email, phone, industry, manual_tier
       FROM leads
       ORDER BY id
       LIMIT $1 OFFSET $2`,
      [PAGE, offset]
    );
    if (rows.length === 0) break;
    for (const lead of rows) {
      let score, tier;
      if (useManualTiers) {
        const out = calculateScore(lead, prefs, industryLabelToTopLevel);
        score = out.score;
        tier = out.tier;
      } else if (profileForTier) {
        const out = calculateScoreFromProfile(lead, profileForTier.userTopLevel, profileForTier.userSub);
        score = out.score;
        tier = out.tier;
      } else {
        score = defaultQualityScore(lead);
        tier = null;
      }
      allUpdates.push({
        id: lead.id,
        preference_score: score,
        preference_tier: tier,
        manual_tier: lead.manual_tier || null,
      });
    }
    offset += PAGE;
    if (rows.length < PAGE) break;
  }

  if (allUpdates.length === 0) return { updated: 0 };

  let finalUpdates = allUpdates;
  if (useManualTiers) {
    finalUpdates = allUpdates.map((u) => ({
      ...u,
      preference_tier: u.preference_tier || 'tertiary',
    }));
  } else if (profileForTier) {
    finalUpdates = allUpdates.map((u) => ({
      ...u,
      preference_tier: u.preference_tier || 'tertiary',
    }));
  } else {
    finalUpdates = allUpdates.map((u) => ({ ...u, preference_tier: 'tertiary' }));
  }

  finalUpdates.forEach(u => {
    const effectiveTier = u.manual_tier || u.preference_tier;
    const { isPriority, reviewStatus } = applyPriorityRule(u.preference_score, effectiveTier, prefs ?? null, null);
    u.is_priority = isPriority;
    u.review_status = reviewStatus;
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of finalUpdates) {
      const reviewStatus = String(u.review_status || '');
      await client.query(
        `UPDATE leads
         SET preference_score = $1,
             preference_tier   = $2,
             is_priority       = $3,
             review_status    = $4,
             approved_at      = CASE WHEN $5 = 'approved' AND approved_at IS NULL THEN NOW() ELSE approved_at END,
             updated_at       = NOW()
         WHERE id = $6`,
        [u.preference_score, u.preference_tier, u.is_priority, reviewStatus, reviewStatus, u.id]
      );
    }
    await client.query('COMMIT');
    const mode = useManualTiers
      ? 'manual preference tiers (Active)'
      : profileForTier
        ? 'profile-based (Paused — industry from Your profile)'
        : 'tertiary (no profile)';
    const tierSummary = useManualTiers || profileForTier
      ? `${finalUpdates.filter(u => u.preference_tier === 'primary').length} primary / ${finalUpdates.filter(u => u.preference_tier === 'secondary').length} secondary / ${finalUpdates.filter(u => u.preference_tier === 'tertiary').length} tertiary`
      : 'dynamic % bands';
    console.log(`[scoring] Recalculated ${finalUpdates.length} leads: ${tierSummary}. Mode: ${mode}.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[scoring] Recalculate failed:', err);
    throw err;
  } finally {
    client.release();
  }

  return { updated: finalUpdates.length };
}

/**
 * Score a single lead (at ingestion). Returns { score, tier, isPriority, reviewStatus }.
 * When preference_active is ON: use manual Primary/Secondary/Tertiary lists. When OFF: use profile-based tiering (Your profile industry).
 */
export async function scoreAndClassifyLead(lead) {
  const prefs = await loadPreferences();
  const tiers = prefs?.preference_tiers && typeof prefs.preference_tiers === 'object' ? prefs.preference_tiers : null;
  const hasTierCriteria = tiers && (
    (tiers.primary && (tiers.primary.titles?.length || tiers.primary.industries?.length || tiers.primary.company_sizes?.length)) ||
    (tiers.secondary && (tiers.secondary.titles?.length || tiers.secondary.industries?.length || tiers.secondary.company_sizes?.length)) ||
    (tiers.tertiary && (tiers.tertiary.titles?.length || tiers.tertiary.industries?.length || tiers.tertiary.company_sizes?.length))
  );
  const preferenceActive = Boolean(prefs?.preference_active);
  const useManualTiers = preferenceActive && hasTierCriteria;

  let score, tier;
  if (useManualTiers) {
    let industryLabelToTopLevel = null;
    try {
      industryLabelToTopLevel = await getIndustryLabelToTopLevelMap();
    } catch (_) {}
    const out = calculateScore(lead, prefs, industryLabelToTopLevel);
    score = out.score;
    tier = out.tier;
  } else {
    const profileForTier = await getProfileForTiering(prefs);
    if (profileForTier) {
      const out = calculateScoreFromProfile(lead, profileForTier.userTopLevel, profileForTier.userSub);
      score = out.score;
      tier = out.tier;
    } else {
      score = defaultQualityScore(lead);
      tier = null;
    }
  }

  const { isPriority, reviewStatus } = applyPriorityRule(score, tier, prefs);
  return {
    score,
    tier: tier || null,
    isPriority,
    reviewStatus,
    shouldAutoApprove: isPriority,
  };
}

// Legacy export for any code that expected assignTier(score, degree, ...)
export function assignTier(score, degree, prefs, leadId = null, peerStats = null) {
  const prefs2 = prefs || {};
  const tiers = prefs2.preference_tiers;
  if (tiers && typeof tiers === 'object') {
    const { tier } = calculateScore({ title: '', company: '', connection_degree: degree }, prefs2);
    return tier || 'tertiary';
  }
  return 'tertiary';
}
