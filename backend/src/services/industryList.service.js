/**
 * Single source for full industry list (Settings dropdowns + preferences analyze).
 * Uses linkedin_industries table; fallback to linkedin_industry_code_v2_all_eng.json.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import pool from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JSON_PATH = path.resolve(__dirname, '../config/linkedin_industry_code_v2_all_eng.json');

let cache = null;

/**
 * Returns all industries: [{ code, name, label, hierarchy, top_level_industry, sub_category }].
 * Cached after first load.
 */
export async function getIndustryList() {
    if (cache) return cache;

    const fromDb = await pool.query(`
        SELECT code, name, hierarchy, top_level_industry, sub_category
        FROM linkedin_industries
        ORDER BY hierarchy ASC, name ASC
    `);

    if (fromDb.rows.length > 0) {
        cache = fromDb.rows.map((r) => ({
            code: r.code,
            name: r.name,
            label: r.name,
            hierarchy: r.hierarchy,
            top_level_industry: r.top_level_industry,
            sub_category: r.sub_category,
        }));
        return cache;
    }

    console.warn('[industries] linkedin_industries table is empty in DB! Falling back to JSON file.');

    if (!fs.existsSync(JSON_PATH)) {
        console.error('[industries] Industry JSON file fallback NOT FOUND at:', JSON_PATH);
        cache = [];
        return cache;
    }

    const raw = fs.readFileSync(JSON_PATH, 'utf8');
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) {
        console.error('[industries] Industry JSON file is not an array!');
        cache = [];
        return cache;
    }

    cache = list.map((item) => {
        const hierarchy = item.hierarchy || item.label || '';
        const parts = hierarchy.split('>').map((p) => p.trim()).filter(Boolean);
        return {
            code: String(item.id ?? item.code ?? ''),
            name: item.label ?? item.name ?? '',
            label: item.label ?? item.name ?? '',
            hierarchy,
            top_level_industry: parts[0] || null,
            sub_category: parts.length >= 2 ? parts[1] : null,
        };
    });
    return cache;
}

/** Returns only the labels (names) for use in preference tiers and analyze. */
export async function getIndustryLabels() {
    const list = await getIndustryList();
    return list.map((i) => i.name || i.label || '').filter(Boolean);
}

/** Clear cache (e.g. after seeding DB). */
export function clearIndustryListCache() {
    cache = null;
}
