/**
 * preferences.controller.js
 *
 * Handles GET/PUT for preference settings and the toggle endpoint.
 * Also exposes a manual "recalculate" endpoint.
 *
 * Endpoints (to be added to settings.routes.js or a new preferences.routes.js):
 *   GET  /api/preferences          – load current preferences
 *   PUT  /api/preferences          – save preferences (triggers rescore)
 *   POST /api/preferences/activate – toggle preference_active
 *   POST /api/preferences/rescore  – manually trigger full rescore
 */

import {
    loadPreferences,
    savePreferences,
    recalculateAllScores,
} from '../services/preferenceScoring.service.js';

const DEFAULT_TIERS = Object.freeze({
    primary: { titles: [], industries: [], company_sizes: [] },
    secondary: { titles: [], industries: [], company_sizes: [] },
    tertiary: { titles: [], industries: [], company_sizes: [] },
});

// Validate: max 5 per dropdown, no duplicate value across tiers
function validatePreferenceTiers(tiers) {
    if (!tiers || typeof tiers !== 'object') return null;
    const all = [];
    const out = { primary: {}, secondary: {}, tertiary: {} };
    for (const tier of ['primary', 'secondary', 'tertiary']) {
        const t = tiers[tier];
        if (!t || typeof t !== 'object') {
            out[tier] = { titles: [], industries: [], company_sizes: [] };
            continue;
        }
        out[tier] = {};
        for (const key of ['titles', 'industries', 'company_sizes']) {
            let arr = Array.isArray(t[key]) ? t[key].filter(Boolean) : [];
            arr = arr.slice(0, 5); // max 5
            const seen = new Set(all.map(String).map(s => s.toLowerCase()));
            arr = arr.filter(v => {
                const vn = String(v).toLowerCase().trim();
                if (seen.has(vn)) return false;
                seen.add(vn);
                all.push(v);
                return true;
            });
            out[tier][key] = arr;
        }
    }
    return out;
}

// GET /api/preferences
export async function getPreferences(req, res) {
    try {
        const prefs = await loadPreferences();
        const fallback = {
            linkedin_profile_url: '',
            preference_tiers: DEFAULT_TIERS,
            secondary_priority_threshold: 70,
            profile_meta: {},
            preference_active: false,
        };
        if (!prefs) return res.json(fallback);
        const prefsTiers = prefs.preference_tiers && typeof prefs.preference_tiers === 'object'
            ? prefs.preference_tiers
            : DEFAULT_TIERS;
        return res.json({
            ...prefs,
            preference_tiers: prefsTiers,
            secondary_priority_threshold: prefs.secondary_priority_threshold ?? 70,
        });
    } catch (err) {
        console.error('[preferences] GET error:', err);
        res.status(500).json({ error: err.message });
    }
}

// PUT /api/preferences
export async function updatePreferences(req, res) {
    try {
        const {
            linkedin_profile_url,
            preference_tiers,
            secondary_priority_threshold,
            profile_meta,
            preference_active,
            preferred_companies,
            preferred_industries,
            preferred_titles,
            preferred_locations,
            niche_keywords,
            primary_threshold,
            secondary_threshold,
            auto_approval_threshold,
        } = req.body;

        if (linkedin_profile_url) {
            process.env.LINKEDIN_PROFILE_URL = linkedin_profile_url;
        }
        if (preferred_companies) {
            process.env.PREFERRED_COMPANY_KEYWORDS = preferred_companies;
        }

        const validatedTiers = preference_tiers != null ? validatePreferenceTiers(preference_tiers) : undefined;
        await savePreferences({
            linkedin_profile_url,
            preference_tiers: validatedTiers,
            secondary_priority_threshold,
            profile_meta,
            preference_active,
            preferred_companies,
            preferred_industries,
            preferred_titles,
            preferred_locations,
            niche_keywords,
            primary_threshold,
            secondary_threshold,
            auto_approval_threshold,
        });

        // Rescore asynchronously — don't block the HTTP response
        recalculateAllScores().catch(err =>
            console.error('[preferences] Background rescore error:', err)
        );

        return res.json({
            success: true,
            message: 'Preferences saved. Rescoring leads in background…',
        });
    } catch (err) {
        console.error('[preferences] PUT error:', err);
        res.status(500).json({ error: err.message });
    }
}

// POST /api/preferences/activate
export async function togglePreferenceActive(req, res) {
    try {
        const { active } = req.body; // boolean
        const prefs = await loadPreferences();
        if (!prefs) return res.status(404).json({ error: 'Preferences not configured' });

        await savePreferences({ ...prefs, preference_active: !!active });

        // Rescoring is needed when activating so leads get proper tier assignments
        if (active) {
            recalculateAllScores().catch(err =>
                console.error('[preferences] Background rescore (toggle) error:', err)
            );
        }

        return res.json({
            success: true,
            preference_active: !!active,
            message: active ? 'Preferences activated. Rescoring leads…' : 'Preferences deactivated.',
        });
    } catch (err) {
        console.error('[preferences] toggle error:', err);
        res.status(500).json({ error: err.message });
    }
}

// POST /api/preferences/rescore
export async function rescoreLeads(req, res) {
    try {
        // Fire off and return immediately
        res.json({ success: true, message: 'Rescore started in background. This may take a moment.' });
        await recalculateAllScores();
    } catch (err) {
        console.error('[preferences] rescore error:', err);
    }
}

// POST /api/preferences/analyze — AI suggest tiered preferences from LinkedIn Profile URL
// Fills Primary, Secondary, and Tertiary with 3–5 options each; no value repeated across tiers.
const TITLE_OPTIONS = ['CEO', 'CTO', 'CFO', 'Director', 'Manager', 'VP', 'Founder', 'Head of', 'Lead', 'Engineer', 'Analyst', 'Consultant', 'Specialist'];
const INDUSTRY_OPTIONS = [
    'Technology, Information and Media', 'Financial Services', 'Professional Services', 'Manufacturing', 'Retail', 'Education',
    'Hospitals and Health Care', 'Marketing & Advertising', 'Construction', 'Real Estate and Equipment Rental Services', 'Other',
];
const SIZE_OPTIONS = ['1-10', '11-50', '51-200', '201-500', '500+'];

function normaliseForDedup(s) {
    return String(s).toLowerCase().trim();
}

/** Pick up to `count` values from `pool` that are not in `exclude` (normalised). Prefer values that contain or are contained in `preferMatch`. */
function pickFromPool(pool, count, exclude = [], preferMatch = '') {
    const out = [];
    const excludeArr = Array.isArray(exclude) ? exclude : [...(exclude || [])];
    const excluded = new Set(excludeArr.map(normaliseForDedup));
    const prefer = normaliseForDedup(preferMatch || '');
    const poolCopy = [...pool];
    // Prefer items that overlap with prefer (e.g. profile title "Software Engineer" -> prefer "Engineer")
    if (prefer) {
        poolCopy.sort((a, b) => {
            const na = normaliseForDedup(a);
            const nb = normaliseForDedup(b);
            const matchA = na && (na === prefer || na.includes(prefer) || prefer.includes(na));
            const matchB = nb && (nb === prefer || nb.includes(prefer) || prefer.includes(nb));
            if (matchA && !matchB) return -1;
            if (!matchA && matchB) return 1;
            return 0;
        });
    }
    for (const v of poolCopy) {
        if (out.length >= count) break;
        const n = normaliseForDedup(v);
        if (!n || excluded.has(n)) continue;
        excluded.add(n);
        out.push(v);
    }
    return out;
}

/** Ensure 3–5 items per category; fill from pool if needed. */
function ensureCount(arr, pool, minCount, excludeSet, prefer) {
    const used = new Set((arr || []).map(normaliseForDedup));
    if (excludeSet) excludeSet.forEach(u => used.add(normaliseForDedup(u)));
    const current = [...(arr || [])];
    const need = Math.max(0, minCount - current.length);
    if (need === 0) return current.slice(0, 5);
    const added = pickFromPool(pool, need, used, prefer);
    return [...current, ...added].slice(0, 5);
}

export async function analyzeProfileForPreferences(req, res) {
    try {
        const { linkedin_profile_url } = req.body || {};
        if (!linkedin_profile_url || typeof linkedin_profile_url !== 'string') {
            return res.status(400).json({ error: 'linkedin_profile_url is required' });
        }
        const url = linkedin_profile_url.trim();
        if (!url.includes('linkedin.com')) {
            return res.status(400).json({ error: 'Valid LinkedIn profile URL is required' });
        }

        let profileMeta = {};
        try {
            const profileEnrichmentService = (await import('../services/profileEnrichment.service.js')).default;
            const profile = await profileEnrichmentService.enrichProfileFromUrl(url);
            if (profile) {
                profileMeta = {
                    title: profile.title || profile.headline,
                    industry: profile.industry,
                    company: profile.company,
                    companySize: profile.companySize || profile.company_size,
                };
            }
        } catch (e) {
            console.warn('[preferences] Analyze profile fetch failed:', e.message);
        }

        const profileTitle = profileMeta.title ? String(profileMeta.title).trim() : '';
        const profileIndustry = profileMeta.industry ? String(profileMeta.industry).trim() : '';
        const profileSize = profileMeta.companySize ? String(profileMeta.companySize).trim() : '';

        // Primary: 3–5 each, starting from profile (then fill from pools)
        const primaryTitles = ensureCount(
            profileTitle ? [profileTitle] : [],
            TITLE_OPTIONS,
            3,
            [],
            profileTitle
        );
        const primaryIndustries = ensureCount(
            profileIndustry ? [profileIndustry] : [],
            INDUSTRY_OPTIONS,
            3,
            [],
            profileIndustry
        );
        const primarySizes = ensureCount(
            profileSize ? [profileSize] : [],
            SIZE_OPTIONS,
            3,
            [],
            profileSize
        );

        const usedTitles = new Set(primaryTitles.map(normaliseForDedup));
        const usedIndustries = new Set(primaryIndustries.map(normaliseForDedup));
        const usedSizes = new Set(primarySizes.map(normaliseForDedup));

        // Secondary: 3–5 each, no overlap with primary
        const secondaryTitles = pickFromPool(TITLE_OPTIONS, 4, usedTitles);
        secondaryTitles.forEach(t => usedTitles.add(normaliseForDedup(t)));
        const secondaryIndustries = pickFromPool(INDUSTRY_OPTIONS, 4, usedIndustries);
        secondaryIndustries.forEach(i => usedIndustries.add(normaliseForDedup(i)));
        const secondarySizes = pickFromPool(SIZE_OPTIONS, 4, usedSizes);
        secondarySizes.forEach(s => usedSizes.add(normaliseForDedup(s)));

        // Tertiary: 3–5 each, no overlap with primary or secondary
        const tertiaryTitles = pickFromPool(TITLE_OPTIONS, 4, usedTitles);
        tertiaryTitles.forEach(t => usedTitles.add(normaliseForDedup(t)));
        const tertiaryIndustries = pickFromPool(INDUSTRY_OPTIONS, 4, usedIndustries);
        const tertiarySizes = pickFromPool(SIZE_OPTIONS, 4, usedSizes);

        const suggested = validatePreferenceTiers({
            primary: { titles: primaryTitles, industries: primaryIndustries, company_sizes: primarySizes },
            secondary: { titles: secondaryTitles, industries: secondaryIndustries, company_sizes: secondarySizes },
            tertiary: { titles: tertiaryTitles, industries: tertiaryIndustries, company_sizes: tertiarySizes },
        }) || DEFAULT_TIERS;

        return res.json({
            success: true,
            suggested,
            profile_meta: profileMeta,
        });
    } catch (err) {
        console.error('[preferences] analyze error:', err);
        res.status(500).json({ error: err.message });
    }
}
