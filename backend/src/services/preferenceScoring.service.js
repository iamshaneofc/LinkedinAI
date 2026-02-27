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
 *   If tier === Primary OR (tier === Secondary AND score >= threshold) then is_priority = true, review_status = 'approved'
 *   Else is_priority = false, review_status = 'to_be_reviewed'
 */

import pool from '../db.js';
import { INDUSTRY_KEYWORDS } from '../config/industries.js';

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

function scoreIndustryMatch(leadIndustry, tiers) {
  if (!tiers || !leadIndustry) return { score: 0, tier: null };
  const primaryIndustries = tiers.primary?.industries || [];
  const secondaryIndustries = tiers.secondary?.industries || [];
  const tertiaryIndustries = tiers.tertiary?.industries || [];
  for (const i of primaryIndustries) {
    if (matchesAny(leadIndustry, [i])) return { score: TIER_SCORE.primary.industry, tier: 'primary' };
  }
  for (const i of secondaryIndustries) {
    if (matchesAny(leadIndustry, [i])) return { score: TIER_SCORE.secondary.industry, tier: 'secondary' };
  }
  for (const i of tertiaryIndustries) {
    if (matchesAny(leadIndustry, [i])) return { score: TIER_SCORE.tertiary.industry, tier: 'tertiary' };
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
 * @param {object} lead – { title, company, location, company_size? } (DB row or plain object)
 * @param {object} prefs – preference_settings row (with preference_tiers JSONB)
 * @returns {{ score: number, tier: string|null }}
 */
export function calculateScore(lead, prefs) {
  const tiers = prefs?.preference_tiers || null;
  if (!tiers || (typeof tiers !== 'object')) {
    return { score: 0, tier: null };
  }

  const leadTitle = lead.title || '';
  const leadIndustry = resolveIndustry(lead.company || '', lead.title || '');
  const leadCompanySize = lead.company_size || null;

  const titleResult = scoreTitleMatch(leadTitle, tiers);
  const industryResult = scoreIndustryMatch(leadIndustry, tiers);
  const companySizeResult = scoreCompanySizeMatch(leadCompanySize, tiers);

  const score = titleResult.score + industryResult.score + companySizeResult.score;
  const matchedTiers = [titleResult.tier, industryResult.tier, companySizeResult.tier].filter(Boolean);
  const tier = highestTier(matchedTiers);

  return { score: Math.round(score), tier };
}

/**
 * My Contacts (is_priority): tier-based only — no fixed score threshold.
 * Primary = high quality, Secondary = warm → both count as My Contacts.
 * Tertiary = less warm → not in My Contacts by default.
 */
export function applyPriorityRule(score, tier, prefs, overrideIsPriority = null) {
  let isPriority = tier === 'primary' || tier === 'secondary';
  if (overrideIsPriority !== null) {
    isPriority = overrideIsPriority;
  }
  const reviewStatus = isPriority ? 'approved' : 'to_be_reviewed';
  return { isPriority, reviewStatus };
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
 * Dynamic tier bands: primary 20–40%, secondary 30–50%, tertiary 40–50%.
 * Picks random valid percentages each rescore so counts vary (not fixed 33/33/33).
 */
function getDynamicTierPercentages() {
  const primaryPct = 0.20 + Math.random() * 0.20;
  const secondaryMax = Math.min(0.50, 0.60 - primaryPct);
  const secondaryMin = Math.max(0.30, 0.50 - primaryPct);
  const secondaryPct = secondaryMin + Math.random() * Math.max(0, secondaryMax - secondaryMin);
  return { pctPrimary: primaryPct, pctSecondary: secondaryPct };
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
 * Recalculate scores for all leads.
 * - Default (no tier fields saved): score = profile completeness, then assign Primary/Secondary/Tertiary by rank (dynamic % bands).
 * - When user has saved tier fields (Save Preferences): hierarchy is set from those fields — leads matching Primary → primary, Secondary → secondary, Tertiary → tertiary; no match → tertiary.
 * - manual_tier is cleared so dashboard reflects this logic.
 */
export async function recalculateAllScores() {
  const prefs = await loadPreferences();

  const tiers = prefs?.preference_tiers && typeof prefs.preference_tiers === 'object' ? prefs.preference_tiers : null;
  const hasTierCriteria = tiers && (
    (tiers.primary && (tiers.primary.titles?.length || tiers.primary.industries?.length || tiers.primary.company_sizes?.length)) ||
    (tiers.secondary && (tiers.secondary.titles?.length || tiers.secondary.industries?.length || tiers.secondary.company_sizes?.length)) ||
    (tiers.tertiary && (tiers.tertiary.titles?.length || tiers.tertiary.industries?.length || tiers.tertiary.company_sizes?.length))
  );
  // When user has saved tier fields: set hierarchy by those fields. Otherwise: keep default (percentile) logic.
  const useProfileScoring = Boolean(hasTierCriteria);

  let offset = 0;
  const PAGE = 1000;
  const allUpdates = [];

  while (true) {
    const { rows } = await pool.query(
      `SELECT id, company, title, location, connection_degree, email
       FROM leads
       ORDER BY id
       LIMIT $1 OFFSET $2`,
      [PAGE, offset]
    );
    if (rows.length === 0) break;
    for (const lead of rows) {
      let score, tier;
      if (useProfileScoring) {
        const out = calculateScore(lead, prefs);
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
      });
    }
    offset += PAGE;
    if (rows.length < PAGE) break;
  }

  if (allUpdates.length === 0) return { updated: 0 };

  let finalUpdates = allUpdates;
  if (useProfileScoring) {
    // Use actual matched tier from preferences; leads that match no tier become tertiary so dashboard totals add up.
    finalUpdates = allUpdates.map((u) => ({
      ...u,
      preference_tier: u.preference_tier || 'tertiary',
    }));
  } else {
    // No tier criteria: assign by score rank (dynamic percentile bands).
    allUpdates.sort((a, b) => {
      if (b.preference_score !== a.preference_score) return b.preference_score - a.preference_score;
      return a.id - b.id;
    });
    const total = allUpdates.length;
    const { pctPrimary, pctSecondary } = getDynamicTierPercentages();
    const primaryCount = Math.max(1, Math.floor(total * pctPrimary));
    const secondaryCount = Math.max(1, Math.floor(total * pctSecondary));
    finalUpdates = allUpdates.map((u, idx) => {
      if (idx < primaryCount) return { ...u, preference_tier: 'primary' };
      if (idx < primaryCount + secondaryCount) return { ...u, preference_tier: 'secondary' };
      return { ...u, preference_tier: 'tertiary' };
    });
  }

  finalUpdates.forEach(u => {
    const { isPriority, reviewStatus } = applyPriorityRule(u.preference_score, u.preference_tier, prefs ?? null, null);
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
    const mode = useProfileScoring ? 'saved profile (preference active)' : 'default quality score';
    const tierSummary = useProfileScoring
      ? `${finalUpdates.filter(u => u.preference_tier === 'primary').length} primary / ${finalUpdates.filter(u => u.preference_tier === 'secondary').length} secondary / ${finalUpdates.filter(u => u.preference_tier === 'tertiary').length} tertiary`
      : 'dynamic % bands';
    console.log(`[scoring] Recalculated ${finalUpdates.length} leads: ${tierSummary}. Mode: ${mode}.`);
    try {
      await pool.query('UPDATE leads SET manual_tier = NULL WHERE manual_tier IS NOT NULL');
    } catch (_) {
      // manual_tier column may not exist on older DBs; tier update already committed
    }
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
 */
export async function scoreAndClassifyLead(lead) {
  const prefs = await loadPreferences();
  const { score, tier } = calculateScore(lead, prefs);
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
