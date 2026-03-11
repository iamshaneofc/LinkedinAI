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

// Helper: update branding (user name, profile image, company) in .env from profile data
async function updateBrandingFromProfile(userName, profileImageUrl, companyName) {
    try {
        const path = (await import('path')).default;
        const fs = (await import('fs')).default;
        const { fileURLToPath } = await import('url');
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const envPath = path.join(__dirname, '..', '..', '.env');
        if (!fs.existsSync(envPath)) return;
        let envContent = fs.readFileSync(envPath, 'utf8');
        const setEnv = (key, value) => {
            if (value === undefined || value === null || value === '') return;
            const str = String(value).trim();
            const regex = new RegExp(`^${key}=.*$`, 'm');
            const line = `${key}=${str}`;
            if (regex.test(envContent)) envContent = envContent.replace(regex, line);
            else envContent += (envContent ? '\n' : '') + line;
            process.env[key] = str;
        };
        if (userName) setEnv('APP_USER_NAME', userName);
        if (profileImageUrl) setEnv('APP_PROFILE_IMAGE_URL', profileImageUrl);
        if (companyName) setEnv('APP_COMPANY_NAME', companyName);
        fs.writeFileSync(envPath, envContent.trim() + '\n');
    } catch (e) {
        console.warn('[preferences] updateBrandingFromProfile:', e.message);
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

        // Apply manual profile_meta to branding (name + company) when user filled "Your profile" and saved
        const meta = profile_meta && typeof profile_meta === 'object' ? profile_meta : {};
        const manualName = meta.name || meta.fullName;
        const manualCompany = meta.company;
        if (manualName || manualCompany) {
            await updateBrandingFromProfile(manualName || undefined, undefined, manualCompany || undefined);
        }

        // Rescore in background so the response returns immediately and Save button stops spinning
        recalculateAllScores().catch(err => console.error('[preferences] Background rescore error:', err));

        return res.json({
            success: true,
            message: 'Preferences saved. Tier counts are updating in the background — refresh the dashboard in a few seconds to see changes.',
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

        // Rescore when toggling so leads get correct tier mode (Active = manual tiers, Paused = profile-based)
        recalculateAllScores().catch(err =>
            console.error('[preferences] Background rescore (toggle) error:', err)
        );

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

// POST /api/preferences/analyze — Fill tiers from profile: manual name/title/industry only (no URL scrape).
const TITLE_OPTIONS = ['CEO', 'CTO', 'CFO', 'Director', 'Manager', 'VP', 'Founder', 'Head of', 'Lead', 'Engineer', 'Analyst', 'Consultant', 'Specialist'];
const INDUSTRY_OPTIONS_FALLBACK = [
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
        const { name, title, industry } = req.body || {};
        const profileName = name && typeof name === 'string' ? name.trim() : '';
        const profileTitle = title && typeof title === 'string' ? title.trim() : '';
        const profileIndustry = industry && typeof industry === 'string' ? industry.trim() : '';

        if (!profileTitle && !profileIndustry) {
            return res.status(400).json({ error: 'Fill at least Title or Industry in Your profile, then click Analyze.' });
        }
        if (!profileName || !profileTitle || !profileIndustry) {
            return res.status(400).json({ error: 'Please set your profile title, industry — everything is mandatory here.' });
        }

        const AIService = (await import('../services/ai.service.js')).default;
        if (!AIService.isConfigured()) {
            return res.status(400).json({ error: 'OpenAI or Claude API key required for Analyze. Configure in Settings.' });
        }

        const { getIndustryLabels } = await import('../services/industryList.service.js');
        const industryLabels = await getIndustryLabels();
        const INDUSTRY_OPTIONS = industryLabels.length > 0 ? industryLabels : INDUSTRY_OPTIONS_FALLBACK;

        const prompt = `You are helping set up lead prioritization tiers for a CRM.

Profile (the user):
- Name: ${profileName || 'Not provided'}
- Title: ${profileTitle || 'Not provided'}
- Industry: ${profileIndustry || 'Not provided'}

Using ONLY the titles, industries, and sizes from the lists below, suggest 3-5 values for each tier. Primary = most relevant to this profile. Secondary = related but not top match. Tertiary = broader/other. No duplicate value across tiers.

Titles (use only these): ${TITLE_OPTIONS.join(', ')}
Industries (use only these): ${INDUSTRY_OPTIONS.slice(0, 80).join(', ')}${INDUSTRY_OPTIONS.length > 80 ? '...' : ''}
Company sizes (use only these): ${SIZE_OPTIONS.join(', ')}

Return ONLY valid JSON (no markdown, no explanation):
{"primary":{"titles":[],"industries":[],"company_sizes":[]},"secondary":{"titles":[],"industries":[],"company_sizes":[]},"tertiary":{"titles":[],"industries":[],"company_sizes":[]}}

Each array must have 3-5 values. Use only exact strings from the lists above.`;

        const raw = await AIService.callAI(prompt, 600, 0.3);
        if (!raw || typeof raw !== 'string') {
            return res.status(500).json({ error: 'AI did not return valid suggestions.' });
        }
        const cleaned = raw.replace(/```\w*\n?/g, '').replace(/```/g, '').trim();
        let parsed;
        try {
            parsed = JSON.parse(cleaned);
        } catch (e) {
            console.warn('[preferences] Analyze AI JSON parse failed:', e.message);
            return res.status(500).json({ error: 'AI response was not valid JSON.' });
        }

        const suggested = validatePreferenceTiers({
            primary: {
                titles: Array.isArray(parsed.primary?.titles) ? parsed.primary.titles.filter(t => TITLE_OPTIONS.includes(t)).slice(0, 5) : [],
                industries: Array.isArray(parsed.primary?.industries) ? parsed.primary.industries.filter(i => INDUSTRY_OPTIONS.includes(i)).slice(0, 5) : [],
                company_sizes: Array.isArray(parsed.primary?.company_sizes) ? parsed.primary.company_sizes.filter(s => SIZE_OPTIONS.includes(s)).slice(0, 5) : [],
            },
            secondary: {
                titles: Array.isArray(parsed.secondary?.titles) ? parsed.secondary.titles.filter(t => TITLE_OPTIONS.includes(t)).slice(0, 5) : [],
                industries: Array.isArray(parsed.secondary?.industries) ? parsed.secondary.industries.filter(i => INDUSTRY_OPTIONS.includes(i)).slice(0, 5) : [],
                company_sizes: Array.isArray(parsed.secondary?.company_sizes) ? parsed.secondary.company_sizes.filter(s => SIZE_OPTIONS.includes(s)).slice(0, 5) : [],
            },
            tertiary: {
                titles: Array.isArray(parsed.tertiary?.titles) ? parsed.tertiary.titles.filter(t => TITLE_OPTIONS.includes(t)).slice(0, 5) : [],
                industries: Array.isArray(parsed.tertiary?.industries) ? parsed.tertiary.industries.filter(i => INDUSTRY_OPTIONS.includes(i)).slice(0, 5) : [],
                company_sizes: Array.isArray(parsed.tertiary?.company_sizes) ? parsed.tertiary.company_sizes.filter(s => SIZE_OPTIONS.includes(s)).slice(0, 5) : [],
            },
        }) || DEFAULT_TIERS;

        const profileMetaForSave = { name: profileName || undefined, title: profileTitle || undefined, industry: profileIndustry || undefined };

        console.log('[Analyze] Filled Primary/Secondary/Tertiary from Your profile (Name, Title, Industry) using AI.');

        return res.json({
            success: true,
            suggested,
            profile_meta: profileMetaForSave,
        });
    } catch (err) {
        console.error('[preferences] analyze error:', err);
        res.status(500).json({ error: err.message });
    }
}
