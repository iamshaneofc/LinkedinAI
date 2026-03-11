import pool from "../db.js";
import profileEnrichmentService from "./profileEnrichment.service.js";
import { scoreAndClassifyLead } from './preferenceScoring.service.js';
import { resolveLeadTopLevel, resolveLeadSubIndustry } from './industryHierarchy.service.js';

// Ensure we never exceed database column limits
function safeTruncate(value, maxLength) {
  if (value === null || value === undefined) return null;
  const str = String(value);
  return str.length > maxLength ? str.slice(0, maxLength) : str;
}

/**
 * Infer industry for a lead from company + title.
 * Uses AI to pick one industry from our list (sub-category when possible); falls back to keyword matching.
 * Called when a lead is saved and industry is missing.
 */
export async function inferLeadIndustry(company = '', title = '') {
  const text = `${company || ''} ${title || ''}`.trim();
  if (!text) return null;

  try {
    const AIService = (await import('./ai.service.js')).default;
    const { getIndustryLabels } = await import('./industryList.service.js');
    const labels = await getIndustryLabels();
    if (labels.length === 0) throw new Error('No industry list');
    if (!AIService.isConfigured()) throw new Error('AI not configured');

    const listStr = labels.slice(0, 120).join(', ');
    const prompt = `Given this company and job title, pick the single best-matching industry from the list below. Reply with ONLY that exact industry name, nothing else.

Company: ${(company || '').slice(0, 200)}
Title: ${(title || '').slice(0, 200)}

Industry list: ${listStr}`;

    const raw = await AIService.callAI(prompt, 100, 0.2);
    if (!raw || typeof raw !== 'string') return null;
    const chosen = raw.replace(/^["']|["']$/g, '').trim().split('\n')[0].trim();
    const normalise = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const nChosen = normalise(chosen);
    const match = labels.find((l) => normalise(l) === nChosen || l === chosen);
    if (match) return match;
  } catch (_) {
    // fallback to keyword
  }

  const topLevel = resolveLeadTopLevel(company, title);
  if (topLevel) {
    const sub = resolveLeadSubIndustry(company, title, topLevel);
    return sub || topLevel;
  }
  return null;
}

/**
 * Check if a lead matches the user's profile niche
 * Auto-qualifies leads that match:
 * - Preferred company keywords (from PREFERRED_COMPANY_KEYWORDS env var)
 * - User's industry (from their LinkedIn profile in database)
 * - User's company/title keywords
 */
export async function matchesUserNiche(lead) {
  try {
    const userProfileUrl = process.env.LINKEDIN_PROFILE_URL;
    const preferredKeywords = (process.env.PREFERRED_COMPANY_KEYWORDS || '')
      .toLowerCase()
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);

    // If no profile URL and no keywords configured, don't auto-qualify
    if (!userProfileUrl && preferredKeywords.length === 0) {
      return false;
    }

    const leadText = `${lead.company || ''} ${lead.title || ''}`.toLowerCase();

    // Check preferred company keywords
    if (preferredKeywords.length > 0) {
      const matchesKeyword = preferredKeywords.some(keyword =>
        leadText.includes(keyword.toLowerCase())
      );
      if (matchesKeyword) {
        console.log(`✅ Auto-qualifying lead: "${lead.company}" matches preferred keyword`);
        return true;
      }
    }

    // Check user's profile data if available
    if (userProfileUrl) {
      const userProfile = await profileEnrichmentService.enrichProfileFromUrl(userProfileUrl);

      if (userProfile) {
        // Check industry match
        if (userProfile.industry) {
          // Extract industry from lead's company/title
          const leadIndustry = profileEnrichmentService.extractIndustryFromCompany(
            lead.company || '',
            lead.title || ''
          );

          if (leadIndustry && leadIndustry === userProfile.industry) {
            console.log(`✅ Auto-qualifying lead: Industry match (${leadIndustry})`);
            return true;
          }
        }

        // Check company/title keyword match from user's profile
        const userText = `${userProfile.company || ''} ${userProfile.title || ''}`.toLowerCase();
        if (userText) {
          // Extract meaningful keywords from user's company/title (2+ chars, not common words)
          const commonWords = ['the', 'and', 'of', 'in', 'at', 'for', 'to', 'a', 'an'];
          const userKeywords = userText
            .split(/\s+/)
            .filter(word => word.length >= 3 && !commonWords.includes(word))
            .slice(0, 5); // Top 5 keywords

          const matchesUserKeywords = userKeywords.some(keyword =>
            leadText.includes(keyword)
          );

          if (matchesUserKeywords && userKeywords.length > 0) {
            console.log(`✅ Auto-qualifying lead: Matches user profile keywords`);
            return true;
          }
        }
      }
    }

    return false;
  } catch (error) {
    console.error('Error checking user niche match:', error);
    // On error, don't auto-qualify (fail safe)
    return false;
  }
}

export async function saveLead(lead) {
  // Assign industry from company+title if missing (AI or keyword fallback)
  if (!lead.industry || !String(lead.industry).trim()) {
    const inferred = await inferLeadIndustry(lead.company || '', lead.title || '');
    lead.industry = inferred || '';
  }

  // Check if lead matches user's niche BEFORE determining review_status
  const matchesNiche = await matchesUserNiche(lead);

  // Score the lead with the tiered preference model (sets is_priority + review_status)
  const { score, tier, isPriority, reviewStatus: scoringReviewStatus } = await scoreAndClassifyLead(lead);

  // Import flow: always use scoring result. Manual/niche: allow niche to approve.
  const fromImport = lead.reviewStatus === 'to_be_reviewed' && lead.source && /phantom|connections_export|search_export|csv_import|excel_import/i.test(lead.source);
  let initialReviewStatus = scoringReviewStatus;
  let initialIsPriority = isPriority;
  if (!fromImport && matchesNiche) {
    initialReviewStatus = 'approved';
    initialIsPriority = initialIsPriority || true;
  }
  if (!fromImport && lead.reviewStatus === 'approved') {
    initialReviewStatus = 'approved';
  }

  const phantomMetadataJson = lead.phantomMetadata && typeof lead.phantomMetadata === 'object'
    ? JSON.stringify(lead.phantomMetadata)
    : null;

  const query = `
    INSERT INTO leads
    (linkedin_url, first_name, last_name, full_name, title, company, location, profile_image, email, phone, source, connection_degree, review_status, preference_score, preference_tier, is_priority, phantom_metadata, industry)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    ON CONFLICT (linkedin_url) DO UPDATE SET
      first_name = COALESCE(EXCLUDED.first_name, leads.first_name),
      last_name = COALESCE(EXCLUDED.last_name, leads.last_name),
      full_name = COALESCE(EXCLUDED.full_name, leads.full_name),
      title = COALESCE(EXCLUDED.title, leads.title),
      company = COALESCE(EXCLUDED.company, leads.company),
      location = COALESCE(EXCLUDED.location, leads.location),
      profile_image = COALESCE(EXCLUDED.profile_image, leads.profile_image),
      email = COALESCE(EXCLUDED.email, leads.email),
      phone = COALESCE(EXCLUDED.phone, leads.phone),
      connection_degree = EXCLUDED.connection_degree,
      review_status = EXCLUDED.review_status,
      preference_score = EXCLUDED.preference_score,
      preference_tier  = EXCLUDED.preference_tier,
      is_priority      = EXCLUDED.is_priority,
      phantom_metadata = COALESCE(EXCLUDED.phantom_metadata, leads.phantom_metadata),
      industry = COALESCE(NULLIF(TRIM(EXCLUDED.industry), ''), leads.industry),
      approved_at = CASE WHEN EXCLUDED.review_status = 'approved' AND leads.approved_at IS NULL THEN NOW() ELSE leads.approved_at END,
      updated_at = NOW()
    RETURNING id, (xmax = 0) AS inserted;
  `;

  const values = [
    safeTruncate(lead.linkedinUrl, 500),
    safeTruncate(lead.firstName, 100),
    safeTruncate(lead.lastName, 100),
    safeTruncate(lead.fullName, 255),
    safeTruncate(lead.title, 255),
    safeTruncate(lead.company, 255),
    safeTruncate(lead.location, 255),
    safeTruncate(lead.profileImage, 500),
    safeTruncate(lead.email, 255),
    safeTruncate(lead.phone, 50),
    safeTruncate(lead.source, 100),
    safeTruncate(lead.connectionDegree || lead.connection_degree, 50),
    safeTruncate(initialReviewStatus, 50),
    score,
    tier || 'tertiary',
    !!initialIsPriority,
    phantomMetadataJson,
    safeTruncate(lead.industry, 255),
  ];

  const result = await pool.query(query, values);
  const row = result.rows[0];
  const wasInserted = row?.inserted;
  const leadId = row?.id;

  // If lead matches niche and was updated (not inserted), promote to approved
  if (matchesNiche && !wasInserted) {
    const currentLead = await pool.query(
      'SELECT review_status FROM leads WHERE linkedin_url = $1',
      [safeTruncate(lead.linkedinUrl, 500)]
    );
    if (currentLead.rows[0]?.review_status === 'to_be_reviewed') {
      await pool.query(
        `UPDATE leads SET review_status = 'approved', is_priority = TRUE, approved_at = CASE WHEN approved_at IS NULL THEN NOW() ELSE approved_at END WHERE linkedin_url = $1`,
        [safeTruncate(lead.linkedinUrl, 500)]
      );
      console.log(`🎯 Auto-qualified existing lead matching your niche: ${lead.company || 'Unknown'} - ${lead.title || 'Unknown'}`);
    }
  }
  if (matchesNiche && wasInserted) {
    console.log(`🎯 Auto-qualified new lead matching your niche: ${lead.company || 'Unknown'} - ${lead.title || 'Unknown'}`);
  }

  // Return { id, inserted: true } only when newly inserted (so callers' "if (saved)" and savedCount stay correct)
  return wasInserted && leadId != null ? { id: leadId, inserted: true } : null;
}
