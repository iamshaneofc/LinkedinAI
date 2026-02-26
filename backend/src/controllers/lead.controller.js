import { processPhantomResults } from "../services/leadPipeline.service.js";
import pool from "../db.js";
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import { INDUSTRY_KEYWORDS } from '../config/industries.js';
import { matchesUserNiche } from '../services/lead.service.js';
import { NotificationService } from '../services/notification.service.js';

// ============================================================================
// CONTACT SCRAPING INTEGRATION (PHASE 6)
// ============================================================================




// ============================================================================
// ADVANCED FILTER CLAUSE BUILDER (Sales Navigator-style enhancements)
// ============================================================================
// Builds SQL WHERE clause from JSON filter structure
// Supports: AND/OR groups, Include/Exclude, multi-value conditions
function buildAdvancedFilterClause(filterJSON, params) {
  if (!filterJSON || !filterJSON.groups || filterJSON.groups.length === 0) return '';

  const groupConditions = [];

  for (const group of filterJSON.groups) {
    if (!group.conditions || group.conditions.length === 0) continue;

    const conditions = [];
    for (const cond of group.conditions) {
      const { field, operator, value, exclude } = cond;
      let clause = '';

      // Field mapping & handling
      if (field === 'industry') {
        const pIdx = params.length + 1;
        // Industry infers from company or title (simplified version of simpler filter logic)
        // If we wanted exact parity with config-based logic it would be complex, 
        // so we treat it as a text search on relevant columns for "contains"/"equals".
        if (operator === 'contains' || operator === 'equals') {
          clause = `(company ILIKE $${pIdx} OR title ILIKE $${pIdx})`;
          params.push(`%${value}%`);
        } else if (operator === 'not_equals') {
          clause = `(company NOT ILIKE $${pIdx} AND title NOT ILIKE $${pIdx})`;
          params.push(`%${value}%`);
        } else if (operator === 'starts_with') {
          clause = `(company ILIKE $${pIdx} OR title ILIKE $${pIdx})`;
          params.push(`${value}%`);
        }
      } else {
        // Standard columns
        let dbCol = field;
        if (field === 'hasEmail') dbCol = 'email';
        else if (field === 'hasLinkedin') dbCol = 'linkedin_url';
        else if (field === 'title') dbCol = 'title';
        else if (field === 'company') dbCol = 'company';
        else if (field === 'location') dbCol = 'location';
        else if (field === 'status') dbCol = 'status';
        else if (field === 'source') dbCol = 'source';
        else if (field === 'review_status') dbCol = 'review_status'; // PHASE 4: Review status
        else if (field === 'created_at') dbCol = 'created_at';

        const pIdx = params.length + 1;

        switch (operator) {
          case 'contains':
            clause = `${dbCol} ILIKE $${pIdx}`;
            params.push(`%${value}%`);
            break;
          case 'not_contains':
            clause = `${dbCol} NOT ILIKE $${pIdx}`;
            params.push(`%${value}%`);
            break;
          case 'equals':
            if (dbCol === 'status' || dbCol === 'source') {
              clause = `${dbCol} = $${pIdx}`;
              params.push(value);
            } else {
              clause = `${dbCol} ILIKE $${pIdx}`; // Case insensitive for text
              params.push(value);
            }
            break;
          case 'not_equals':
            if (dbCol === 'status' || dbCol === 'source') {
              clause = `${dbCol} != $${pIdx}`;
              params.push(value);
            } else {
              clause = `${dbCol} NOT ILIKE $${pIdx}`;
              params.push(value);
            }
            break;
          case 'starts_with':
            clause = `${dbCol} ILIKE $${pIdx}`;
            params.push(`${value}%`);
            break;
          case 'includes': // Location-specific
            clause = `${dbCol} ILIKE $${pIdx}`;
            params.push(`%${value}%`);
            break;
          case 'excludes': // Location-specific negative
            clause = `${dbCol} NOT ILIKE $${pIdx}`;
            params.push(`%${value}%`);
            break;
          case 'exists': // Boolean fields (hasEmail, hasLinkedin)
            clause = `(${dbCol} IS NOT NULL AND ${dbCol} != '')`;
            break;
          case 'not_exists': // Boolean fields negative
            clause = `(${dbCol} IS NULL OR ${dbCol} = '')`;
            break;
          // Legacy operators (backward compatibility)
          case 'is_true':
            clause = `(${dbCol} IS NOT NULL AND ${dbCol} != '')`;
            break;
          case 'is_false':
            clause = `(${dbCol} IS NULL OR ${dbCol} = '')`;
            break;
          // Date operators
          case 'after':
            clause = `${dbCol} > $${pIdx}`;
            params.push(value);
            break;
          case 'before':
            clause = `${dbCol} < $${pIdx}`;
            params.push(value);
            break;
        }
      }

      // Apply EXCLUDE logic (Sales Navigator-style)
      // Exclude wraps the condition in NOT
      if (clause) {
        if (exclude) {
          clause = `NOT (${clause})`;
        }
        conditions.push(clause);
      }
    }

    if (conditions.length > 0) {
      groupConditions.push(`(${conditions.join(' AND ')})`);
    }
  }

  if (groupConditions.length === 0) return '';
  return `(${groupConditions.join(' OR ')})`;
}

// GET /api/leads
// Supports basic → advanced filters via query params:
// - filters: JSON string for advanced logic
// - OR legacy simple params (source, status, etc.)
export async function getLeads(req, res) {
  try {
    const {
      page = 1,
      limit = 50,
      filters, // New JSON param
      // Legacy params
      source,
      status,
      review_status, // PHASE 4: Review status filter
      hasEmail,
      hasLinkedin,
      has_contact_info, // My Contacts filter: leads with email OR phone
      is_priority,      // My Contacts page: AI high-priority leads only
      search,
      title,
      location,
      company,
      industry,
      quality, // 'primary', 'secondary', 'tertiary'
      connection_degree,
      createdFrom,
      createdTo,
    } = req.query;

    const pageNumber = parseInt(page, 10) || 1;
    const pageLimit = parseInt(limit, 10) || 50;
    const offset = (pageNumber - 1) * pageLimit;

    const conditionClauses = [];
    const params = [];

    // Check for Advanced Filters first
    if (filters) {
      try {
        const filterJSON = JSON.parse(filters);
        const advancedClause = buildAdvancedFilterClause(filterJSON, params);
        if (advancedClause) {
          conditionClauses.push(advancedClause);
        }
      } catch (e) {
        console.error("Failed to parse filters JSON", e);
        // Fallback or error? For now, we'll continue and maybe matching other params will happen (unlikely to mix)
      }
    } else {
      // --- Legacy / Simple Filter Logic ---

      // Simple equality filters
      if (source && source !== 'all') {
        // Support comma-separated sources for imported leads filter
        if (source.includes(',')) {
          const sources = source.split(',').map(s => s.trim()).filter(s => s);
          if (sources.length > 0) {
            const placeholders = sources.map((_, i) => `$${params.length + i + 1}`).join(', ');
            conditionClauses.push(`source IN (${placeholders})`);
            params.push(...sources);
          }
        } else {
          conditionClauses.push(`source = $${params.length + 1}`);
          params.push(source);
        }
      }

      if (status && status !== 'all') {
        conditionClauses.push(`status = $${params.length + 1}`);
        params.push(status);
      }

      // PHASE 4: Review status filter (omit when quality is set so list ranks ALL leads, then filters by tab to match review-stats counts)
      if (review_status && review_status !== 'all' && !quality) {
        conditionClauses.push(`review_status = $${params.length + 1}`);
        params.push(review_status);
      }

      // Boolean-style filters
      if (hasEmail === "true") {
        conditionClauses.push(`email IS NOT NULL AND email != ''`);
      }

      if (hasLinkedin === "true") {
        conditionClauses.push(`linkedin_url IS NOT NULL AND linkedin_url != ''`);
      }

      // My Contacts: leads with email OR phone
      if (has_contact_info === "true") {
        conditionClauses.push(`((email IS NOT NULL AND email != '') OR (phone IS NOT NULL AND phone != ''))`);
      }

      // My Contacts page: AI high-priority leads only (is_priority = true)
      if (is_priority === "true") {
        conditionClauses.push(`is_priority = TRUE`);
      }

      // Lead Search–style meta filters (same fields as Lead Search page)
      if (title && title.trim()) {
        conditionClauses.push(`title ILIKE $${params.length + 1}`);
        params.push(`%${title.trim()}%`);
      }
      if (location && location.trim()) {
        conditionClauses.push(`location ILIKE $${params.length + 1}`);
        params.push(`%${location.trim()}%`);
      }
      if (company && company.trim()) {
        conditionClauses.push(`company ILIKE $${params.length + 1}`);
        params.push(`%${company.trim()}%`);
      }
      if (connection_degree && connection_degree.trim()) {
        const degrees = connection_degree.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
        if (degrees.length > 0) {
          const degreeClauses = degrees.map((_, i) => `connection_degree ILIKE $${params.length + i + 1}`);
          conditionClauses.push(`(${degreeClauses.join(' OR ')})`);
          degrees.forEach(d => params.push(`%${d}%`));
        }
      }

      // Complex Industry Logic (preserved for Simple Mode)
      if (industry && industry.trim()) {
        const industryName = industry.trim();
        const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        if (industryName === 'Other') {
          const allKeywords = Object.values(INDUSTRY_KEYWORDS).flat();
          if (allKeywords.length > 0) {
            const allRegex = allKeywords.map(k => escapeRegExp(k)).join('|');
            conditionClauses.push(`(COALESCE(company, '') || ' ' || COALESCE(title, '')) !~* $${params.length + 1}`);
            params.push(`(${allRegex})`);
          }
        } else if (INDUSTRY_KEYWORDS[industryName]) {
          const industryKeys = Object.keys(INDUSTRY_KEYWORDS);
          const targetIndex = industryKeys.indexOf(industryName);
          const currentKeywords = INDUSTRY_KEYWORDS[industryName];
          const currentRegex = currentKeywords.map(k => escapeRegExp(k)).join('|');

          conditionClauses.push(`(COALESCE(company, '') || ' ' || COALESCE(title, '')) ~* $${params.length + 1}`);
          params.push(`(${currentRegex})`);

          if (targetIndex > 0) {
            const priorIndustries = industryKeys.slice(0, targetIndex);
            const priorKeywords = priorIndustries.flatMap(k => INDUSTRY_KEYWORDS[k]);
            if (priorKeywords.length > 0) {
              const priorRegex = priorKeywords.map(k => escapeRegExp(k)).join('|');
              conditionClauses.push(`(COALESCE(company, '') || ' ' || COALESCE(title, '')) !~* $${params.length + 1}`);
              params.push(`(${priorRegex})`);
            }
          }
        } else {
          conditionClauses.push(
            `(company ILIKE $${params.length + 1} OR title ILIKE $${params.length + 1})`
          );
          params.push(`%${industryName}%`);
        }
      }

      // Date range filters
      if (createdFrom) {
        conditionClauses.push(`created_at >= $${params.length + 1}`);
        params.push(createdFrom);
      }

      if (createdTo) {
        conditionClauses.push(`created_at <= $${params.length + 1}`);
        params.push(createdTo);
      }
    }

    // Global Search (applies on top of filters)
    if (search && search.trim()) {
      conditionClauses.push(
        `(full_name ILIKE $${params.length + 1} OR company ILIKE $${params.length + 1} OR title ILIKE $${params.length + 1})`
      );
      params.push(`%${search.trim()}%`);
    }

    const whereClause = conditionClauses.length ? ` WHERE ${conditionClauses.join(" AND ")}` : "";

    // Determine sort order: preference order (tier → score → recency) vs default (recency)
    // We check preference_active from DB in a lightweight way using a subquery.
    let orderClause = 'ORDER BY created_at DESC';
    try {
      const prefRow = await pool.query(
        'SELECT preference_active FROM preference_settings WHERE id = 1'
      );
      if (prefRow.rows[0]?.preference_active) {
        orderClause = `ORDER BY
          CASE preference_tier WHEN 'primary' THEN 1 WHEN 'secondary' THEN 2 ELSE 3 END ASC,
          preference_score DESC,
          created_at DESC`;
      }
    } catch { /* preference_settings table may not exist yet — fall back gracefully */ }

    // Quality/tier filter — use stored preference_tier column (fast, no PERCENT_RANK CTE)
    if (quality) {
      const tierConditions = [...conditionClauses, `preference_tier = $${params.length + 1}`];
      const rsFilter = review_status && review_status !== 'all'
        ? `review_status = $${params.length + 2}` : null;
      if (rsFilter) tierConditions.push(rsFilter);

      const tierWhere = `WHERE ${tierConditions.join(' AND ')}`;
      const tierParams = [...params, quality, ...(rsFilter ? [review_status] : [])];

      const qResult = await pool.query(
        `SELECT * FROM leads ${tierWhere} ${orderClause}
         LIMIT $${tierParams.length + 1} OFFSET $${tierParams.length + 2}`,
        [...tierParams, pageLimit, offset]
      );
      const qCount = await pool.query(
        `SELECT COUNT(*) AS count FROM leads ${tierWhere}`,
        tierParams
      );
      return res.json({
        leads: qResult.rows,
        pagination: {
          total: parseInt(qCount.rows[0].count, 10),
          page: pageNumber,
          limit: pageLimit,
        },
      });
    }

    // Standard (non-quality) data fetch
    const dataResult = await pool.query(
      `SELECT * FROM leads ${whereClause} ${orderClause}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageLimit, offset]
    );
    const countResult = await pool.query(
      `SELECT COUNT(*) AS count FROM leads ${whereClause}`,
      params
    );

    return res.json({
      leads: dataResult.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count, 10),
        page: pageNumber,
        limit: pageLimit,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/leads/search
export async function searchLeads(req, res) {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: "Query parameter is required" });

    const searchTerm = `%${query}%`;
    const result = await pool.query(
      `SELECT * FROM leads 
       WHERE full_name ILIKE $1 
       OR company ILIKE $1 
       OR title ILIKE $1 
       OR email ILIKE $1
       OR location ILIKE $1
       OR notes ILIKE $1
       ORDER BY created_at DESC`,
      [searchTerm]
    );

    return res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/leads/:id
export async function getLeadById(req, res) {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM leads WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Lead not found" });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// PUT /api/leads/:id
export async function updateLead(req, res) {
  try {
    const { id } = req.params;
    const {
      status,
      title,
      company,
      first_name,
      last_name,
      // Mapping camelCase to snake_case if sent from frontend
      firstName,
      lastName,
      // Additional fields
      email,
      phone,
      location,
      linkedin_url,
      source,
      notes,
      profile_image,
      connection_degree,
      review_status,
      rejected_reason
    } = req.body;

    // Handle loose mapping
    const finalFirstName = first_name || firstName;
    const finalLastName = last_name || lastName;

    const result = await pool.query(
      `UPDATE leads 
       SET status = COALESCE($1, status),
           title = COALESCE($2, title),
           company = COALESCE($3, company),
           first_name = COALESCE($4, first_name),
           last_name = COALESCE($5, last_name),
           email = COALESCE($6, email),
           phone = COALESCE($7, phone),
           location = COALESCE($8, location),
           linkedin_url = COALESCE($9, linkedin_url),
           source = COALESCE($10, source),
           notes = COALESCE($11, notes),
           profile_image = COALESCE($12, profile_image),
           connection_degree = COALESCE($13, connection_degree),
           review_status = COALESCE($14, review_status),
           rejected_reason = COALESCE($15, rejected_reason),
           updated_at = NOW()
       WHERE id = $16
       RETURNING *`,
      [
        status,
        title,
        company,
        finalFirstName,
        finalLastName,
        email,
        phone,
        location,
        linkedin_url,
        source,
        notes,
        profile_image,
        connection_degree,
        review_status,
        rejected_reason,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Lead not found" });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Update lead error:", err);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/leads
export async function createLead(req, res) {
  try {
    const {
      full_name,
      first_name,
      last_name,
      firstName,
      lastName,
      company,
      title,
      email,
      phone,
      linkedin_url,
      location,
      source,
      notes,
      profile_image
    } = req.body;

    const finalFirstName = first_name || firstName;
    const finalLastName = last_name || lastName;
    const finalFullName = full_name || `${finalFirstName || ''} ${finalLastName || ''}`.trim();

    // Check if lead matches user's niche for auto-qualification
    const leadForNicheCheck = { company, title };
    const matchesNiche = await matchesUserNiche(leadForNicheCheck);
    const reviewStatus = matchesNiche ? 'approved' : 'to_be_reviewed';

    const result = await pool.query(
      `INSERT INTO leads (
         full_name, first_name, last_name, company, title, 
         email, phone, linkedin_url, location, source, 
         notes, profile_image, status, review_status, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'new', $13, NOW(), NOW())
       RETURNING *`,
      [
        finalFullName, finalFirstName, finalLastName, company, title,
        email, phone, linkedin_url, location, source || 'manual',
        notes, profile_image, reviewStatus
      ]
    );

    if (matchesNiche) {
      console.log(`🎯 Auto-qualified manually created lead: ${company || 'Unknown'} - ${title || 'Unknown'}`);
    }

    await NotificationService.create({
      type: 'lead_created',
      title: 'Lead added',
      message: `${finalFullName || company || 'New lead'} was added to your contacts`,
      data: { leadId: result.rows[0].id, link: `/leads/${result.rows[0].id}` },
    });

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    // Handle unique constraint violation for linkedin_url
    if (err.code === '23505') {
      return res.status(409).json({ error: "Lead with this LinkedIn URL already exists." });
    }
    console.error("Create lead error:", err);
    res.status(500).json({ error: err.message });
  }
}

// DELETE /api/leads/:id
export async function deleteLead(req, res) {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM leads WHERE id = $1 RETURNING *", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Lead not found" });
    }

    return res.json({ success: true, message: "Lead deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/leads/stats
export async function getStats(req, res) {
  try {
    const {
      connection_degree,
      industry,
      title,
      company,
      location,
      status,
      filters,
      createdFrom,
      createdTo,
      source
    } = req.query;

    const params = [];
    let whereConditions = [];

    // Re-use logic from getLeads for building whereConditions
    if (source && source !== 'all') {
      if (source.includes(',')) {
        const sources = source.split(',').map(s => s.trim()).filter(s => s);
        if (sources.length > 0) {
          const placeholders = sources.map((_, i) => `$${params.length + i + 1}`).join(', ');
          whereConditions.push(`source IN (${placeholders})`);
          params.push(...sources);
        }
      } else {
        whereConditions.push(`source = $${params.length + 1}`);
        params.push(source);
      }
    }

    if (status && status !== 'all') {
      whereConditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    if (title && title.trim()) {
      whereConditions.push(`title ILIKE $${params.length + 1}`);
      params.push(`%${title.trim()}%`);
    }
    if (location && location.trim()) {
      whereConditions.push(`location ILIKE $${params.length + 1}`);
      params.push(`%${location.trim()}%`);
    }
    if (company && company.trim()) {
      whereConditions.push(`company ILIKE $${params.length + 1}`);
      params.push(`%${company.trim()}%`);
    }
    if (connection_degree && connection_degree.trim()) {
      const degrees = connection_degree.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
      if (degrees.length > 0) {
        const degreeClauses = degrees.map((_, i) => `connection_degree ILIKE $${params.length + i + 1}`);
        whereConditions.push(`(${degreeClauses.join(' OR ')})`);
        degrees.forEach(d => params.push(`%${d}%`));
      }
    }

    if (createdFrom) {
      whereConditions.push(`created_at >= $${params.length + 1}`);
      params.push(createdFrom);
    }
    if (createdTo) {
      whereConditions.push(`created_at <= $${params.length + 1}`);
      params.push(createdTo);
    }

    if (filters) {
      try {
        const advancedClause = buildAdvancedFilterClause(JSON.parse(filters), params);
        if (advancedClause) whereConditions.push(advancedClause);
      } catch (e) { }
    }

    const whereClause = whereConditions.length > 0
      ? 'WHERE ' + whereConditions.join(' AND ')
      : '';

    const totalLeads = await pool.query(`SELECT COUNT(*) FROM leads ${whereClause}`, params);
    const statusBreakdown = await pool.query(
      `SELECT status, COUNT(*) FROM leads ${whereClause} GROUP BY status`, params
    );
    const sourceBreakdown = await pool.query(
      `SELECT source, COUNT(*) FROM leads ${whereClause} GROUP BY source`, params
    );

    // Count duplicates (leads with same linkedin_url)
    const dupWhere = whereConditions.length > 0
      ? whereClause + ` AND linkedin_url IS NOT NULL AND linkedin_url != ''`
      : `WHERE linkedin_url IS NOT NULL AND linkedin_url != ''`;

    const duplicatesResult = await pool.query(
      `SELECT COUNT(*) - COUNT(DISTINCT linkedin_url) as duplicates 
       FROM leads 
       ${dupWhere}`, params
    );

    const stats = {
      totalLeads: parseInt(totalLeads.rows[0].count),
      statusCount: statusBreakdown.rows.reduce((acc, row) => {
        acc[row.status] = parseInt(row.count);
        return acc;
      }, {}),
      sourceCount: sourceBreakdown.rows.reduce((acc, row) => {
        acc[row.source || 'unknown'] = parseInt(row.count);
        return acc;
      }, {}),
      duplicates: parseInt(duplicatesResult.rows[0]?.duplicates || 0)
    };

    return res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// DELETE /api/leads/all - Danger: wipes all leads & related data
export async function deleteAllLeads(req, res) {
  try {
    // Optional: simple safeguard via query flag
    const { confirm } = req.query;
    if (confirm !== "true") {
      return res.status(400).json({
        error: "This is a destructive operation. Call with ?confirm=true to proceed."
      });
    }

    // Delete dependent rows first (FKs with ON DELETE CASCADE handle most of this,
    // but being explicit keeps things clear and future-proof)
    await pool.query("DELETE FROM lead_enrichment");
    await pool.query("DELETE FROM campaign_leads");

    // Finally, delete all leads
    const result = await pool.query("DELETE FROM leads");
    const deletedCount = result.rowCount || 0;

    console.log(`🧹 Deleted all leads. Count: ${deletedCount}`);

    return res.json({
      success: true,
      message: `Deleted ${deletedCount} leads and cleared related data.`,
      deleted: deletedCount
    });
  } catch (err) {
    console.error("❌ Error deleting all leads:", err.message);
    res.status(500).json({ error: err.message });
  }
}

// GET /api/leads/imports
export async function getImports(req, res) {
  try {
    const { limit = 100 } = req.query;
    const result = await pool.query(
      "SELECT * FROM import_logs ORDER BY timestamp DESC LIMIT $1",
      [parseInt(limit)]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching imports:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/leads/import
export async function importLeads(req, res) {
  try {
    const { resultUrl, source } = req.body || {};

    if (!resultUrl) {
      return res.status(400).json({ error: "resultUrl is required" });
    }

    const response = await fetch(resultUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch result: ${response.statusText}`);
    }

    const data = await response.json();
    const summary = await processPhantomResults(data, { source });

    return res.json({
      success: true,
      source,
      ...summary
    });

  } catch (err) {
    console.error("❌ Lead import error:", err.message);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/leads/:id/enrich
export async function enrichLead(req, res) {
  try {
    const { id } = req.params;

    // Import enrichment service
    const { default: enrichmentService } = await import('../services/enrichment.service.js');

    // Trigger enrichment (async process)
    const result = await enrichmentService.enrichLead(id);

    return res.json({
      success: result.success,
      message: result.source === 'mock'
        ? 'Lead enrichment completed (using mock data - configure PROFILE_SCRAPER_PHANTOM_ID for real enrichment)'
        : 'Lead enrichment completed successfully',
      source: result.source,
      leadId: result.leadId
    });
  } catch (err) {
    console.error('Enrich lead error:', err);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/leads/enrich-batch
// Enrich multiple selected leads (from Phantom imports or CSV) in one request
export async function enrichLeadsBatch(req, res) {
  try {
    const { leadIds } = req.body || {};

    if (!leadIds || (Array.isArray(leadIds) && leadIds.length === 0)) {
      // PROGRESIVE BATCH LOGIC
      // Start background batch if no specific leads provided
      const { default: hunterProgressiveService } = await import("../services/hunter-progressive.service.js");
      try {
        const result = await hunterProgressiveService.startBatch();
        return res.json(result);
      } catch (err) {
        return res.status(500).json({ error: "Failed to start progressive enrichment batch" });
      }
    }

    if (!Array.isArray(leadIds)) {
      return res.status(400).json({
        error: "leadIds must be an array of lead IDs",
      });
    }

    // Import enrichment service lazily to avoid circular deps on startup
    const { default: enrichmentService } = await import(
      "../services/enrichment.service.js"
    );

    const results = await enrichmentService.enrichLeads(leadIds);

    return res.json({
      success: true,
      count: leadIds.length,
      results,
    });
  } catch (err) {
    console.error("Enrich leads batch error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /api/leads/:id/enrichment
export async function getLeadEnrichment(req, res) {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM lead_enrichment WHERE lead_id = $1", [id]);
    return res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/leads/:id/generate-message
// Generate a personalized message using profile scraping (enrichment) data and AI
export async function generatePersonalizedMessage(req, res) {
  try {
    const { id } = req.params;
    const { type = 'connection_request', tone, length, focus } = req.body || {};

    const leadResult = await pool.query("SELECT * FROM leads WHERE id = $1", [id]);
    const lead = leadResult.rows[0];
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const enrichmentResult = await pool.query("SELECT * FROM lead_enrichment WHERE lead_id = $1", [id]);
    const enrichment = enrichmentResult.rows[0] || null;

    const AIService = (await import("../services/ai.service.js")).default;
    const options = { tone: tone || 'professional', length: length || 'medium', focus: focus || 'general' };

    let message;
    if (type === 'follow_up') {
      message = await AIService.generateFollowUpMessage(lead, enrichment, [], options);
    } else {
      message = await AIService.generateConnectionRequest(lead, enrichment, options);
    }

    return res.json({ message, hasEnrichment: !!enrichment });
  } catch (err) {
    console.error("Generate personalized message error:", err);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/leads/:id/generate-gmail
// Generate a Gmail/email draft (subject + body) for this lead; optionally add to campaign approval queue
export async function generateGmail(req, res) {
  try {
    const { id } = req.params;
    const { campaignId, tone, length, focus } = req.body || {};

    const leadResult = await pool.query("SELECT * FROM leads WHERE id = $1", [id]);
    const lead = leadResult.rows[0];
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const enrichmentResult = await pool.query("SELECT * FROM lead_enrichment WHERE lead_id = $1", [id]);
    const enrichment = enrichmentResult.rows[0] || null;

    let campaignContext = null;
    if (campaignId) {
      const campaignRes = await pool.query(
        "SELECT goal, type, description, target_audience FROM campaigns WHERE id = $1",
        [parseInt(campaignId, 10)]
      );
      if (campaignRes.rows[0]) {
        campaignContext = campaignRes.rows[0];
      }
    }

    const AIService = (await import("../services/ai.service.js")).default;
    const options = {
      tone: tone || "professional",
      length: length || "medium",
      focus: focus || "general",
      campaign: campaignContext
    };
    const { subject, body } = await AIService.generateGmailDraft(lead, enrichment, options);

    const cid = campaignId ? parseInt(campaignId, 10) : null;
    if (cid) {
      const { ApprovalService } = await import("../services/approval.service.js");
      const content = JSON.stringify({ subject, body });
      await ApprovalService.addToQueue(cid, lead.id, "gmail_outreach", content);
    }

    return res.json({ subject, body, hasEnrichment: !!enrichment, addedToQueue: !!cid });
  } catch (err) {
    console.error("Generate Gmail error:", err);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/leads/:id/add-gmail-to-approvals
// Add an existing Gmail draft (subject + body) to a campaign's approval queue
export async function addGmailToApprovals(req, res) {
  try {
    const { id } = req.params;
    const { campaignId, subject, body } = req.body || {};
    if (!campaignId || subject == null || body == null) {
      return res.status(400).json({ error: "campaignId, subject, and body are required" });
    }
    const leadId = parseInt(id, 10);
    const cid = parseInt(campaignId, 10);
    const leadCheck = await pool.query("SELECT id FROM leads WHERE id = $1", [leadId]);
    if (leadCheck.rows.length === 0) {
      return res.status(404).json({ error: "Lead not found" });
    }
    const campaignCheck = await pool.query("SELECT id FROM campaigns WHERE id = $1", [cid]);
    if (campaignCheck.rows.length === 0) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    const clCheck = await pool.query(
      "SELECT 1 FROM campaign_leads WHERE campaign_id = $1 AND lead_id = $2",
      [cid, leadId]
    );
    if (clCheck.rows.length === 0) {
      await pool.query(
        "INSERT INTO campaign_leads (campaign_id, lead_id, status) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [cid, leadId, "new"]
      );
    }
    const { ApprovalService } = await import("../services/approval.service.js");
    const content = JSON.stringify({ subject: String(subject), body: String(body) });
    const row = await ApprovalService.addToQueue(cid, leadId, "gmail_outreach", content);
    return res.json({ id: row.id, added: true });
  } catch (err) {
    console.error("Add Gmail to approvals error:", err);
    res.status(500).json({ error: err.message });
  }
}

// GET /api/leads/enriched - Get all enriched leads
export async function getEnrichedLeads(req, res) {
  try {
    const { limit = 50 } = req.query;
    const result = await pool.query(`
      SELECT 
        l.id,
        l.full_name,
        l.company,
        l.title,
        l.linkedin_url,
        l.email,
        le.bio,
        le.interests,
        le.mutual_connections_count,
        le.recent_posts,
        le.company_news,
        le.last_enriched_at
      FROM leads l
      INNER JOIN lead_enrichment le ON l.id = le.lead_id
      ORDER BY le.last_enriched_at DESC
      LIMIT $1
    `, [parseInt(limit)]);
    return res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/leads/bulk-enrich-personalize
export async function bulkEnrichAndPersonalize(req, res) {
  try {
    const { leadIds, campaignId } = req.body || {};

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ error: "leadIds is required" });
    }

    if (!campaignId) {
      return res.status(400).json({ error: "campaignId is required" });
    }

    // Ensure leads are in the campaign
    const existingLeads = await pool.query(
      "SELECT lead_id FROM campaign_leads WHERE campaign_id = $1 AND lead_id = ANY($2)",
      [campaignId, leadIds]
    );
    const existingIds = new Set(existingLeads.rows.map(r => r.lead_id));
    const newLeads = leadIds.filter(id => !existingIds.has(id));

    // Add new leads to campaign
    if (newLeads.length > 0) {
      console.log(`📝 Adding ${newLeads.length} new leads to campaign ${campaignId}`);
      for (const leadId of newLeads) {
        await pool.query(
          "INSERT INTO campaign_leads (campaign_id, lead_id, status) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
          [campaignId, leadId, 'new']
        );
      }
    }

    // Fetch campaign details for context
    const campaignResult = await pool.query('SELECT goal, type, description, target_audience FROM campaigns WHERE id = $1', [campaignId]);
    const campaign = campaignResult.rows[0] || null;
    const campaignContext = campaign ? {
      goal: campaign.goal,
      type: campaign.type,
      description: campaign.description,
      target_audience: campaign.target_audience
    } : null;

    // Get campaign's first sequence step to determine message type
    const sequenceResult = await pool.query(`
      SELECT type FROM sequences 
      WHERE campaign_id = $1 
      ORDER BY step_order ASC 
      LIMIT 1
    `, [campaignId]);

    const stepType = sequenceResult.rows[0]?.type || 'message';

    // Import services
    const { default: enrichmentService } = await import('../services/enrichment.service.js');
    const { default: AIService } = await import('../services/ai.service.js');
    const { ApprovalService } = await import('../services/approval.service.js');

    // Get lead details
    const leadsResult = await pool.query(
      `SELECT id, first_name, last_name, linkedin_url, title, company 
       FROM leads 
       WHERE id = ANY($1)`,
      [leadIds]
    );

    const leads = leadsResult.rows.filter(l => l.linkedin_url && l.linkedin_url.trim().length > 0);

    if (leads.length === 0) {
      return res.status(400).json({
        error: 'No leads with LinkedIn URLs found'
      });
    }

    const results = {
      enriched: 0,
      generated: 0,
      failed: [],
      skipped: [],
      total: leads.length
    };

    // Process each lead
    for (let index = 0; index < leads.length; index++) {
      const lead = leads[index];
      try {
        // Check if already has pending approval
        const existingApproval = await pool.query(
          `SELECT id FROM approval_queue 
           WHERE campaign_id = $1 AND lead_id = $2 AND status = 'pending'`,
          [campaignId, lead.id]
        );

        if (existingApproval.rows.length > 0) {
          console.log(`⏭️  Lead ${lead.id} already has pending approval, skipping`);
          results.generated++;
          continue;
        }

        // STEP 1: Enrich the lead
        console.log(`🔍 [${index + 1}/${leads.length}] Enriching lead: ${lead.first_name} ${lead.last_name} (ID: ${lead.id})`);
        let enrichmentData = null;
        try {
          const enrichResult = await enrichmentService.enrichLead(lead.id);
          if (enrichResult && enrichResult.success) {
            results.enriched++;
            enrichmentData = enrichResult.enrichmentData;
            console.log(`   ✅ Enriched (source: ${enrichResult.source || 'unknown'})`);
          }
        } catch (enrichError) {
          console.error(`   ⚠️  Enrichment failed: ${enrichError.message}`);
          // Try to fetch existing enrichment
          const dbEnrichment = await enrichmentService.getEnrichment(lead.id);
          if (dbEnrichment) {
            enrichmentData = {
              bio: dbEnrichment.bio,
              interests: dbEnrichment.interests,
              recent_posts: dbEnrichment.recent_posts
            };
          }
        }

        // STEP 2: Generate AI message with enrichment data and campaign context
        console.log(`   🤖 Generating AI message (stepType: ${stepType})...`);
        let personalizedMessage;
        try {
          const options = campaignContext ? { campaign: campaignContext } : {};
          if (enrichmentData) {
            if (stepType === 'connection_request') {
              personalizedMessage = await AIService.generateConnectionRequest(lead, enrichmentData, options);
            } else {
              personalizedMessage = await AIService.generateFollowUpMessage(lead, enrichmentData, [], options);
            }
          } else {
            personalizedMessage = await AIService.generatePersonalizedMessage(
              lead.id,
              '',
              stepType
            );
          }
        } catch (aiError) {
          console.error(`   ⚠️  AI generation failed: ${aiError.message}`);
          if (enrichmentData && enrichmentData.bio) {
            const bioSnippet = enrichmentData.bio.substring(0, 80);
            personalizedMessage = `That bit in your profile about ${bioSnippet}... resonated. Would be great to connect.`;
          } else {
            personalizedMessage = `Your work at ${lead.company || 'your company'} caught my eye—would like to connect.`;
          }
        }

        if (!personalizedMessage || personalizedMessage.trim().length === 0) {
          personalizedMessage = `Your work at ${lead.company || 'your company'} caught my eye—would like to connect.`;
        }

        console.log(`   📝 Message generated (${personalizedMessage.length} chars)`);

        // STEP 3: Add to approval queue
        const queueResult = await ApprovalService.addToQueue(
          parseInt(campaignId),
          lead.id,
          stepType,
          personalizedMessage
        );

        if (!queueResult || !queueResult.id) {
          throw new Error('Failed to add message to approval queue');
        }

        results.generated++;
        console.log(`   ✅ Complete! Approval Queue ID: ${queueResult.id}`);

        // Delay to avoid rate limiting (2 seconds between leads)
        if (index < leads.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

      } catch (error) {
        console.error(`   ❌ ERROR processing lead ${lead.id}:`, error.message);
        results.failed.push({
          leadId: lead.id,
          name: `${lead.first_name} ${lead.last_name}`,
          error: error.message
        });
      }
    }

    return res.json({
      success: true,
      message: `Processed ${results.generated} leads. ${results.enriched} enriched, ${results.failed.length} failed.`,
      results
    });

  } catch (err) {
    console.error("Bulk enrich and personalize error:", err);
    res.status(500).json({ error: err.message });
  }
}

// Helper to respect DB column length limits
function safeTruncate(value, maxLength) {
  if (value === null || value === undefined) return null;
  const str = String(value);
  return str.length > maxLength ? str.slice(0, maxLength) : str;
}

// POST /api/leads/import-csv
export async function importLeadsFromCSV(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No CSV file uploaded" });
    }

    // Read the uploaded CSV file
    const fileContent = fs.readFileSync(req.file.path, 'utf8');

    // Parse CSV
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    if (records.length === 0) {
      // Clean up the uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "CSV file is empty" });
    }

    let saved = 0;
    let duplicates = 0;
    let errors = 0;
    const errorDetails = [];

    // Process each record
    for (const record of records) {
      try {
        // Map CSV columns to database fields (flexible mapping)
        const leadData = {
          full_name: record.full_name || record.fullName || record.name || record['Full Name'] || null,
          first_name: record.first_name || record.firstName || record['First Name'] || null,
          last_name: record.last_name || record.lastName || record['Last Name'] || null,
          title: record.title || record.jobTitle || record['Job Title'] || null,
          company: record.company || record.companyName || record['Company'] || null,
          location: record.location || record.Location || null,
          linkedin_url: record.linkedin_url || record.linkedinUrl || record.profileUrl || record['LinkedIn URL'] || null,
          email: record.email || record.Email || null,
          phone: record.phone || record.Phone || null,
          source: record.source || 'csv_import',
          status: 'new'
        };

        // Skip if no meaningful data
        if (!leadData.full_name && !leadData.first_name && !leadData.linkedin_url) {
          errors++;
          errorDetails.push({ row: record, reason: 'Missing required fields (name or LinkedIn URL)' });
          continue;
        }

        // Check if lead matches user's niche for auto-qualification
        const leadForNicheCheck = { company: leadData.company, title: leadData.title };
        const matchesNiche = await matchesUserNiche(leadForNicheCheck);
        const reviewStatus = matchesNiche ? 'approved' : 'to_be_reviewed';

        // Apply DB-safe truncation to respect column sizes
        const values = [
          safeTruncate(leadData.full_name, 255),      // full_name VARCHAR(255)
          safeTruncate(leadData.first_name, 100),     // first_name VARCHAR(100)
          safeTruncate(leadData.last_name, 100),      // last_name VARCHAR(100)
          safeTruncate(leadData.title, 255),          // title VARCHAR(255)
          safeTruncate(leadData.company, 255),        // company VARCHAR(255)
          safeTruncate(leadData.location, 255),       // location VARCHAR(255)
          safeTruncate(leadData.linkedin_url, 500),   // linkedin_url VARCHAR(500)
          safeTruncate(leadData.email, 255),          // email VARCHAR(255)
          safeTruncate(leadData.phone, 50),           // phone VARCHAR(50)
          safeTruncate(leadData.source, 100),         // source VARCHAR(100)
          leadData.status,                            // status VARCHAR(50) default 'new'
          reviewStatus                                // review_status VARCHAR(50)
        ];

        // Try to insert, handle duplicates
        const result = await pool.query(
          `INSERT INTO leads (
            full_name, first_name, last_name, title, company, 
            location, linkedin_url, email, phone, source, status, review_status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (linkedin_url) DO NOTHING
          RETURNING id`,
          values
        );

        if (result.rows.length > 0) {
          saved++;
        } else {
          duplicates++;
        }
      } catch (err) {
        errors++;
        errorDetails.push({ row: record, reason: err.message });
        console.error('Error inserting lead:', err.message);
      }
    }

    // Clean up the uploaded file
    fs.unlinkSync(req.file.path);

    // Log import to database (optional)
    try {
      await pool.query(
        `INSERT INTO import_logs (source, total_leads, saved, duplicates, timestamp)
         VALUES ($1, $2, $3, $4, NOW())`,
        ['csv_import', records.length, saved, duplicates]
      );
    } catch (err) {
      console.error('Failed to log import:', err.message);
    }

    if (saved > 0) {
      await NotificationService.create({
        type: 'lead_imported',
        title: 'CSV import completed',
        message: `Imported ${saved} leads from CSV${duplicates > 0 ? ` (${duplicates} duplicates skipped)` : ''}`,
        data: { saved, duplicates, errors, link: `/leads?highlight=recent_import` },
      });
    }

    return res.json({
      success: true,
      summary: {
        totalLeads: records.length,
        saved,
        duplicates,
        errors,
        errorDetails: errorDetails.length > 0 ? errorDetails.slice(0, 10) : []
      }
    });

  } catch (err) {
    console.error("❌ CSV import error:", err.message);

    // Clean up the file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ error: err.message });
  }
}

// POST /api/leads/import-excel
export async function importLeadsFromExcel(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No Excel file uploaded" });
    }

    // Dynamic import to avoid crash if not installed
    let xlsx;
    try {
      const module = await import('xlsx');
      xlsx = module.default || module;
    } catch (e) {
      console.error("❌ xlsx library not found. Please run 'npm install xlsx'");
      return res.status(500).json({ error: "Excel import capability is currently unavailable on the server. Please check server dependencies." });
    }

    // Read the uploaded Excel file
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Convert to JSON
    const records = xlsx.utils.sheet_to_json(worksheet, {
      defval: null,
      raw: true
    });

    if (records.length === 0) {
      // Clean up the uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Excel file is empty" });
    }

    let saved = 0;
    let duplicates = 0;
    let errors = 0;
    const errorDetails = [];

    // Process each record
    for (const record of records) {
      try {
        // Map Excel columns to database fields (flexible mapping with fallbacks)
        const leadData = {
          full_name: record.full_name || record.fullName || record.full_name || record.name || record.Name || record['Full Name'] || record['full name'] || null,
          first_name: record.first_name || record.firstName || record['First Name'] || record['first name'] || null,
          last_name: record.last_name || record.lastName || record['Last Name'] || record['last name'] || null,
          title: record.title || record.jobTitle || record['Job Title'] || record['title'] || record['JobTitle'] || null,
          company: record.company || record.companyName || record['Company'] || record['company'] || record['CompanyName'] || null,
          location: record.location || record.Location || record['location'] || null,
          linkedin_url: record.linkedin_url || record.linkedinUrl || record.profileUrl || record['LinkedIn URL'] || record['Profile URL'] || record['linkedin'] || null,
          email: record.email || record.Email || record['email'] || null,
          phone: record.phone || record.Phone || record['phone'] || record['Phone Number'] || null,
          source: record.source || 'excel_import',
          status: 'new'
        };

        // Skip if no meaningful data
        if (!leadData.full_name && !leadData.first_name && !leadData.linkedin_url) {
          errors++;
          errorDetails.push({ row: record, reason: 'Missing required fields (name or LinkedIn URL)' });
          continue;
        }

        // Check if lead matches user's niche for auto-qualification
        const leadForNicheCheck = { company: leadData.company, title: leadData.title };
        const matchesNiche = await matchesUserNiche(leadForNicheCheck);
        const reviewStatus = matchesNiche ? 'approved' : 'to_be_reviewed';

        // Apply DB-safe truncation to respect column sizes
        const values = [
          safeTruncate(leadData.full_name, 255),
          safeTruncate(leadData.first_name, 100),
          safeTruncate(leadData.last_name, 100),
          safeTruncate(leadData.title, 255),
          safeTruncate(leadData.company, 255),
          safeTruncate(leadData.location, 255),
          safeTruncate(leadData.linkedin_url, 500),
          safeTruncate(leadData.email, 255),
          safeTruncate(leadData.phone, 50),
          safeTruncate(leadData.source, 100),
          leadData.status,
          reviewStatus
        ];

        // Try to insert, handle duplicates
        const result = await pool.query(
          `INSERT INTO leads (
            full_name, first_name, last_name, title, company, 
            location, linkedin_url, email, phone, source, status, review_status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (linkedin_url) DO NOTHING
          RETURNING id`,
          values
        );

        if (result.rows.length > 0) {
          saved++;
        } else {
          duplicates++;
        }
      } catch (err) {
        errors++;
        errorDetails.push({ row: record, reason: err.message });
        console.error('Error inserting lead from Excel:', err.message);
      }
    }

    // Clean up the uploaded file
    fs.unlinkSync(req.file.path);

    // Log import to database
    try {
      await pool.query(
        `INSERT INTO import_logs (source, total_leads, saved, duplicates, timestamp)
         VALUES ($1, $2, $3, $4, NOW())`,
        ['excel_import', records.length, saved, duplicates]
      );
    } catch (err) {
      console.error('Failed to log Excel import:', err.message);
    }

    return res.json({
      success: true,
      summary: {
        totalLeads: records.length,
        saved,
        duplicates,
        errors,
        errorDetails: errorDetails.length > 0 ? errorDetails.slice(0, 10) : []
      }
    });

  } catch (err) {
    console.error("❌ Excel import error:", err.message);

    // Clean up the file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ error: err.message });
  }
}

// DELETE /api/leads/csv-imports
export async function deleteCSVLeads(req, res) {
  try {
    // Count leads before deletion
    const countResult = await pool.query(
      "SELECT COUNT(*) FROM leads WHERE source = $1",
      ['csv_import']
    );
    const count = parseInt(countResult.rows[0].count, 10);

    if (count === 0) {
      return res.json({
        success: true,
        message: "No CSV imported leads found",
        deleted: 0
      });
    }

    // Delete all leads with source = 'csv_import'
    const result = await pool.query(
      "DELETE FROM leads WHERE source = $1",
      ['csv_import']
    );

    console.log(`🗑️ Deleted ${count} CSV imported leads`);

    return res.json({
      success: true,
      message: `Successfully deleted ${count} CSV imported leads`,
      deleted: count
    });

  } catch (err) {
    console.error("❌ Error deleting CSV leads:", err.message);
    res.status(500).json({ error: err.message });
  }
}

// DELETE /api/leads/imported/all - Delete all imported leads (CSV and Excel)
export async function deleteAllImportedLeads(req, res) {
  try {
    // Count leads before deletion
    const countResult = await pool.query(
      "SELECT COUNT(*) FROM leads WHERE source IN ($1, $2)",
      ['csv_import', 'excel_import']
    );
    const count = parseInt(countResult.rows[0].count, 10);

    if (count === 0) {
      return res.json({
        success: true,
        message: "No imported leads found",
        deleted: 0
      });
    }

    // Delete all leads with source = 'csv_import' or 'excel_import'
    const result = await pool.query(
      "DELETE FROM leads WHERE source IN ($1, $2)",
      ['csv_import', 'excel_import']
    );

    console.log(`🗑️ Deleted ${count} imported leads (CSV and Excel)`);

    return res.json({
      success: true,
      message: `Successfully deleted ${count} imported leads`,
      deleted: count
    });
  } catch (err) {
    console.error("❌ Delete imported leads error:", err.message);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/leads/bulk-delete - Delete multiple leads by IDs
export async function bulkDeleteLeads(req, res) {
  try {
    const { leadIds } = req.body;

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ error: 'leadIds array is required' });
    }

    // Delete leads and related data
    // First delete from dependent tables
    await pool.query(
      "DELETE FROM lead_enrichment WHERE lead_id = ANY($1)",
      [leadIds]
    );
    await pool.query(
      "DELETE FROM campaign_leads WHERE lead_id = ANY($1)",
      [leadIds]
    );

    // Then delete the leads
    const result = await pool.query(
      "DELETE FROM leads WHERE id = ANY($1) RETURNING id",
      [leadIds]
    );

    console.log(`🗑️ Deleted ${result.rowCount} leads`);

    return res.json({
      success: true,
      message: `Successfully deleted ${result.rowCount} leads`,
      deleted: result.rowCount
    });
  } catch (err) {
    console.error("❌ Bulk delete leads error:", err.message);
    res.status(500).json({ error: err.message });
  }
}

// ============================================================================
// PHASE 4: Lead Review & Approval Endpoints
// ============================================================================

// Helper function to log status changes to audit table
async function logStatusChange(leadId, previousStatus, newStatus, changedBy, reason = null) {
  try {
    await pool.query(
      `INSERT INTO lead_review_audit (lead_id, previous_status, new_status, changed_by, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [leadId, previousStatus, newStatus, changedBy, reason]
    );
  } catch (err) {
    console.error('Failed to log status change:', err);
    // Don't throw - audit logging failure shouldn't block the operation
  }
}

// POST /api/leads/bulk-approve
// Approve multiple leads for campaigns and export
export async function bulkApproveLeads(req, res) {
  try {
    const { leadIds } = req.body;

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ error: 'leadIds array is required' });
    }

    // Get current status for audit logging
    const currentLeads = await pool.query(
      `SELECT id, review_status FROM leads WHERE id = ANY($1)`,
      [leadIds]
    );

    // Update leads to approved
    const result = await pool.query(
      `UPDATE leads 
       SET review_status = 'approved',
           approved_at = CURRENT_TIMESTAMP,
           approved_by = $1,
           rejected_reason = NULL,
           rejected_at = NULL,
           rejected_by = NULL
       WHERE id = ANY($2)
       RETURNING id`,
      [req.user?.id || null, leadIds]
    );


    // Log audit trail
    for (const lead of currentLeads.rows) {
      if (lead.review_status !== 'approved') {
        await logStatusChange(lead.id, lead.review_status, 'approved', req.user?.id || null);
      }
    }

    console.log(`✅ Approved ${result.rowCount} leads`);

    await NotificationService.create({
      type: 'approval_approved',
      title: 'Leads approved',
      message: `${result.rowCount} leads approved for campaigns`,
      data: { leadIds, count: result.rowCount, link: `/leads?highlight=${leadIds.join(',')}` },
    });



    res.json({
      success: true,
      message: `Successfully approved ${result.rowCount} leads`,
      count: result.rowCount,
      scrapingTriggered: true // Indicate that scraping was initiated
    });

  } catch (err) {
    console.error('❌ Bulk approve error:', err);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/leads/bulk-reject
// Reject multiple leads with optional reason
export async function bulkRejectLeads(req, res) {
  try {
    const { leadIds, reason } = req.body;

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ error: 'leadIds array is required' });
    }

    // Validate reason if provided
    const validReasons = ['not_icp', 'low_quality', 'duplicate', 'wrong_geography', 'other'];
    if (reason && !validReasons.includes(reason)) {
      return res.status(400).json({
        error: 'Invalid reason. Must be one of: ' + validReasons.join(', ')
      });
    }

    // Get current status for audit logging
    const currentLeads = await pool.query(
      `SELECT id, review_status FROM leads WHERE id = ANY($1)`,
      [leadIds]
    );

    // Update leads to rejected
    const result = await pool.query(
      `UPDATE leads 
       SET review_status = 'rejected',
           rejected_reason = $1,
           rejected_at = CURRENT_TIMESTAMP,
           rejected_by = $2,
           approved_at = NULL,
           approved_by = NULL
       WHERE id = ANY($3)
       RETURNING id`,
      [reason || 'other', req.user?.id || null, leadIds]
    );

    // Log audit trail
    for (const lead of currentLeads.rows) {
      if (lead.review_status !== 'rejected') {
        await logStatusChange(lead.id, lead.review_status, 'rejected', req.user?.id || null, reason);
      }
    }

    console.log(`❌ Rejected ${result.rowCount} leads (reason: ${reason || 'not specified'})`);

    await NotificationService.create({
      type: 'approval_rejected',
      title: 'Leads rejected',
      message: `${result.rowCount} leads rejected${reason ? ` (${reason})` : ''}`,
      data: { leadIds, count: result.rowCount, reason, link: `/leads?highlight=${leadIds.join(',')}` },
    });

    res.json({
      success: true,
      message: `Successfully rejected ${result.rowCount} leads`,
      count: result.rowCount
    });

  } catch (err) {
    console.error('❌ Bulk reject error:', err);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/leads/back-to-review
// My Contacts: move leads back to review (is_priority = false, review_status = 'to_be_reviewed'). Does NOT change connection_degree.
export async function backToReview(req, res) {
  try {
    const { leadIds } = req.body;
    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ error: 'leadIds array is required' });
    }
    const result = await pool.query(
      `UPDATE leads
       SET is_priority = FALSE,
           review_status = 'to_be_reviewed',
           approved_at = NULL,
           approved_by = NULL,
           rejected_reason = NULL,
           rejected_at = NULL,
           rejected_by = NULL,
           updated_at = NOW()
       WHERE id = ANY($1)
       RETURNING id`,
      [leadIds]
    );
    console.log(`↩ Back to Review: ${result.rowCount} leads (My Contacts)`);
    return res.json({
      success: true,
      message: `Moved ${result.rowCount} leads back to review`,
      count: result.rowCount,
    });
  } catch (err) {
    console.error('backToReview error:', err);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/leads/move-to-review
// Move leads back to review status (from approved or rejected)
export async function moveToReview(req, res) {
  try {
    const { leadIds, reset_all } = req.body;

    // RESET WORKFLOW: Move all approved leads to review and change default
    if (reset_all) {
      console.log('🔄 Resetting workflow: Changing default and moving leads...');

      // 1. Change default
      await pool.query("ALTER TABLE leads ALTER COLUMN review_status SET DEFAULT 'to_be_reviewed'");

      // 2. Move leads
      const result = await pool.query(`
        UPDATE leads 
        SET review_status = 'to_be_reviewed' 
        WHERE review_status = 'approved' OR review_status IS NULL
      `);

      return res.status(200).json({
        success: true,
        message: `Workflow reset: ${result.rowCount} leads moved to review queue`,
        count: result.rowCount
      });
    }

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ error: 'leadIds array is required' });
    }

    // Get current status for audit logging
    const currentLeads = await pool.query(
      `SELECT id, review_status FROM leads WHERE id = ANY($1)`,
      [leadIds]
    );

    // Update leads to to_be_reviewed
    const result = await pool.query(
      `UPDATE leads 
       SET review_status = 'to_be_reviewed',
           approved_at = NULL,
           approved_by = NULL,
           rejected_reason = NULL,
           rejected_at = NULL,
           rejected_by = NULL
       WHERE id = ANY($1)
       RETURNING id`,
      [leadIds]
    );

    // Log audit trail
    for (const lead of currentLeads.rows) {
      if (lead.review_status !== 'to_be_reviewed') {
        await logStatusChange(lead.id, lead.review_status, 'to_be_reviewed', req.user?.id || null);
      }
    }

    console.log(`↩ Moved ${result.rowCount} leads back to review`);

    res.json({
      success: true,
      message: `Successfully moved ${result.rowCount} leads to review`,
      count: result.rowCount
    });

  } catch (err) {
    console.error('❌ Move to review error:', err);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/leads/qualify-by-niche
// Qualify all leads that match the user's profile niche
export async function qualifyLeadsByNiche(req, res) {
  try {
    const { reviewStatus = 'to_be_reviewed' } = req.body; // Optional: filter by current review_status

    // Get all leads that are in review (or specified status)
    const leadsQuery = `
      SELECT id, company, title, review_status 
      FROM leads 
      WHERE review_status = $1
    `;
    const leadsResult = await pool.query(leadsQuery, [reviewStatus]);

    if (leadsResult.rows.length === 0) {
      return res.json({
        success: true,
        message: `No leads found with status '${reviewStatus}'`,
        qualified: 0,
        total: 0
      });
    }

    // Check each lead against user's niche
    const leadsToQualify = [];
    for (const lead of leadsResult.rows) {
      const matchesNiche = await matchesUserNiche({ company: lead.company, title: lead.title });
      if (matchesNiche) {
        leadsToQualify.push(lead.id);
      }
    }

    if (leadsToQualify.length === 0) {
      return res.json({
        success: true,
        message: `No leads match your profile niche`,
        qualified: 0,
        total: leadsResult.rows.length
      });
    }

    // Get current status for audit logging
    const currentLeads = await pool.query(
      `SELECT id, review_status FROM leads WHERE id = ANY($1)`,
      [leadsToQualify]
    );

    // Update matching leads to approved
    const result = await pool.query(
      `UPDATE leads 
       SET review_status = 'approved',
           approved_at = CASE WHEN approved_at IS NULL THEN CURRENT_TIMESTAMP ELSE approved_at END,
           approved_by = $1,
           rejected_reason = NULL,
           rejected_at = NULL,
           rejected_by = NULL
       WHERE id = ANY($2)
       RETURNING id`,
      [req.user?.id || null, leadsToQualify]
    );

    // Log audit trail
    for (const lead of currentLeads.rows) {
      if (lead.review_status !== 'approved') {
        await logStatusChange(lead.id, lead.review_status, 'approved', req.user?.id || null, 'Auto-qualified by niche match');
      }
    }

    console.log(`🎯 Qualified ${result.rowCount} leads matching user's niche`);
    res.json({
      success: true,
      message: `Qualified ${result.rowCount} lead(s) matching your profile niche`,
      qualified: result.rowCount,
      total: leadsResult.rows.length
    });
  } catch (err) {
    console.error('❌ Qualify by niche error:', err);
    res.status(500).json({ error: err.message });
  }
}

// GET /api/leads/review-stats
// Get counts for each review status
// GET /api/leads/review-stats
// Get counts for each review status
export async function getReviewStats(req, res) {
  try {
    const {
      connection_degree,
      quality,
      quality_score,
      industry,
      title,
      company,
      location,
      status,
      filters,
      createdFrom,
      createdTo
    } = req.query;

    const params = [];
    let whereConditions = [];

    // Connection Degree Filter (Support comma-separated e.g. "2nd,3rd")
    if (connection_degree && connection_degree.trim()) {
      const degrees = connection_degree.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
      if (degrees.length > 0) {
        const degreeClauses = degrees.map((_, i) => `connection_degree ILIKE $${params.length + i + 1}`);
        whereConditions.push(`(${degreeClauses.join(' OR ')})`);
        degrees.forEach(d => params.push(`%${d}%`));
      }
    }

    // Industry Filter
    if (industry && industry.trim()) {
      const industryName = industry.trim();
      const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      if (industryName === 'Other') {
        const allKeywords = Object.values(INDUSTRY_KEYWORDS).flat();
        if (allKeywords.length > 0) {
          const allRegex = allKeywords.map(k => escapeRegExp(k)).join('|');
          whereConditions.push(`(COALESCE(company, '') || ' ' || COALESCE(title, '')) !~* $${params.length + 1}`);
          params.push(`(${allRegex})`);
        }
      } else if (INDUSTRY_KEYWORDS[industryName]) {
        const industryKeys = Object.keys(INDUSTRY_KEYWORDS);
        const targetIndex = industryKeys.indexOf(industryName);
        const currentKeywords = INDUSTRY_KEYWORDS[industryName];
        const currentRegex = currentKeywords.map(k => escapeRegExp(k)).join('|');

        whereConditions.push(`(COALESCE(company, '') || ' ' || COALESCE(title, '')) ~* $${params.length + 1}`);
        params.push(`(${currentRegex})`);

        if (targetIndex > 0) {
          const priorIndustries = industryKeys.slice(0, targetIndex);
          const priorKeywords = priorIndustries.flatMap(k => INDUSTRY_KEYWORDS[k]);
          if (priorKeywords.length > 0) {
            const priorRegex = priorKeywords.map(k => escapeRegExp(k)).join('|');
            whereConditions.push(`(COALESCE(company, '') || ' ' || COALESCE(title, '')) !~* $${params.length + 1}`);
            params.push(`(${priorRegex})`);
          }
        }
      } else {
        whereConditions.push(
          `(company ILIKE $${params.length + 1} OR title ILIKE $${params.length + 1})`
        );
        params.push(`%${industryName}%`);
      }
    }

    // Title Filter
    if (title && title.trim()) {
      whereConditions.push(`title ILIKE $${params.length + 1}`);
      params.push(`%${title.trim()}%`);
    }

    // Company Filter
    if (company && company.trim()) {
      whereConditions.push(`company ILIKE $${params.length + 1}`);
      params.push(`%${company.trim()}%`);
    }

    // Location Filter
    if (location && location.trim()) {
      whereConditions.push(`location ILIKE $${params.length + 1}`);
      params.push(`%${location.trim()}%`);
    }

    // Status Filter (Lead Status, not Review Status)
    if (status && status !== 'all') {
      whereConditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    // Date Range Filters
    if (createdFrom) {
      whereConditions.push(`created_at >= $${params.length + 1}`);
      params.push(createdFrom);
    }
    if (createdTo) {
      whereConditions.push(`created_at <= $${params.length + 1}`);
      params.push(createdTo);
    }

    // Advanced Filters (JSON)
    if (filters) {
      try {
        const filterJSON = JSON.parse(filters);
        // Note: buildAdvancedFilterClause mutates params by pushing values
        const advancedClause = buildAdvancedFilterClause(filterJSON, params);
        if (advancedClause) {
          // Since buildAdvancedFilterClause returns a string like "(...)", we can just push it to whereConditions
          // which are joined by AND.
          // CAUTION: buildAdvancedFilterClause assumes params are appended. 
          // It uses params.length inside. Logic seems safe as we push to params here too.
          whereConditions.push(advancedClause);
        }
      } catch (e) {
        console.error("Failed to parse filters JSON in getReviewStats", e);
      }
    }

    const whereClause = whereConditions.length > 0
      ? 'WHERE ' + whereConditions.join(' AND ')
      : '';

    // Quality filter — uses stored preference_tier column (fast, no CTE calculation)
    const qScore = quality_score || quality;
    let result;

    if (qScore) {
      // Support comma-separated tier list e.g. "primary,secondary"
      const tiers = qScore.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const tierPlaceholders = tiers.map((_, i) => `$${params.length + 1 + i}`).join(', ');
      const tierConditions = [...whereConditions, `preference_tier IN (${tierPlaceholders})`];
      const tierWhere = tierConditions.length > 0 ? 'WHERE ' + tierConditions.join(' AND ') : '';

      result = await pool.query(`
        SELECT review_status, COUNT(*) AS count
        FROM leads
        ${tierWhere}
        GROUP BY review_status
      `, [...params, ...tiers]);

    } else {
      // Standard path — no quality filter
      result = await pool.query(`
        SELECT review_status, COUNT(*) AS count
        FROM leads
        ${whereClause}
        GROUP BY review_status
      `, params);
    }

    // Also get imported leads count (csv_import or excel_import)
    const importedWhereClause = whereConditions.length > 0
      ? whereClause + ' AND (source = $' + (params.length + 1) + ' OR source = $' + (params.length + 2) + ')'
      : 'WHERE (source = $1 OR source = $2)';
    const importedParams = whereConditions.length > 0
      ? [...params, 'csv_import', 'excel_import']
      : ['csv_import', 'excel_import'];

    const importedResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM leads
      ${importedWhereClause}
    `, importedParams);

    // Format response with default values
    const stats = {
      to_be_reviewed: 0,
      approved: 0,
      rejected: 0,
      imported: parseInt(importedResult.rows[0]?.count || 0, 10),
      total: 0
    };

    result.rows.forEach(row => {
      // Only count leads with actual review_status values
      // Do NOT treat NULL as 'approved' - this was causing count mismatches
      const status = row.review_status;
      if (status && stats[status] !== undefined) {
        stats[status] = parseInt(row.count, 10);
      }
      stats.total += parseInt(row.count, 10);
    });

    res.json({
      success: true,
      reviewStats: stats
    });
  } catch (err) {
    console.error('getReviewStats error:', err);
    res.status(500).json({ error: err.message });
  }
}



// GET /api/leads/export
export async function exportLeads(req, res) {
  try {
    const {
      format = 'csv',
      filters, // New JSON param
      // Legacy params
      source,
      status,
      review_status, // PHASE 4: Review status filter
      hasEmail,
      hasLinkedin,
      search,
      title,
      location,
      company,
      industry,
      quality, // 'primary', 'secondary', 'tertiary'
      connection_degree,
      createdFrom,
      createdTo,
    } = req.query;

    const conditionClauses = [];
    const params = [];

    // Check for Advanced Filters first
    if (filters) {
      try {
        const filterJSON = JSON.parse(filters);
        const advancedClause = buildAdvancedFilterClause(filterJSON, params);
        if (advancedClause) {
          conditionClauses.push(advancedClause);
        }
      } catch (e) {
        console.error("Failed to parse filters JSON", e);
      }
    } else {
      // --- Legacy / Simple Filter Logic ---
      if (source && source !== 'all') {
        conditionClauses.push(`source = $${params.length + 1}`);
        params.push(source);
      }
      if (status && status !== 'all') {
        conditionClauses.push(`status = $${params.length + 1}`);
        params.push(status);
      }
      if (review_status && review_status !== 'all') {
        conditionClauses.push(`review_status = $${params.length + 1}`);
        params.push(review_status);
      }
      if (hasEmail === "true") {
        conditionClauses.push(`email IS NOT NULL AND email != ''`);
      }
      if (hasLinkedin === "true") {
        conditionClauses.push(`linkedin_url IS NOT NULL AND linkedin_url != ''`);
      }
      if (title && title.trim()) {
        conditionClauses.push(`title ILIKE $${params.length + 1}`);
        params.push(`%${title.trim()}%`);
      }
      if (location && location.trim()) {
        conditionClauses.push(`location ILIKE $${params.length + 1}`);
        params.push(`%${location.trim()}%`);
      }
      if (company && company.trim()) {
        conditionClauses.push(`company ILIKE $${params.length + 1}`);
        params.push(`%${company.trim()}%`);
      }
      if (connection_degree && connection_degree.trim()) {
        const degree = connection_degree.trim().toLowerCase();
        conditionClauses.push(`connection_degree ILIKE $${params.length + 1}`);
        params.push(`%${degree}%`);
      }

      if (industry && industry.trim()) {
        const industryName = industry.trim();
        const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        if (industryName === 'Other') {
          const allKeywords = Object.values(INDUSTRY_KEYWORDS).flat();
          if (allKeywords.length > 0) {
            const allRegex = allKeywords.map(k => escapeRegExp(k)).join('|');
            conditionClauses.push(`(COALESCE(company, '') || ' ' || COALESCE(title, '')) !~* $${params.length + 1}`);
            params.push(`(${allRegex})`);
          }
        } else if (INDUSTRY_KEYWORDS[industryName]) {
          const targetKeywords = INDUSTRY_KEYWORDS[industryName];
          const currentRegex = targetKeywords.map(k => escapeRegExp(k)).join('|');
          conditionClauses.push(`(COALESCE(company, '') || ' ' || COALESCE(title, '')) ~* $${params.length + 1}`);
          params.push(`(${currentRegex})`);
        } else {
          conditionClauses.push(`(company ILIKE $${params.length + 1} OR title ILIKE $${params.length + 1})`);
          params.push(`%${industryName}%`);
        }
      }

      if (createdFrom) {
        conditionClauses.push(`created_at >= $${params.length + 1}`);
        params.push(createdFrom);
      }
      if (createdTo) {
        conditionClauses.push(`created_at <= $${params.length + 1}`);
        params.push(createdTo);
      }
    }

    if (search && search.trim()) {
      conditionClauses.push(`(full_name ILIKE $${params.length + 1} OR company ILIKE $${params.length + 1} OR title ILIKE $${params.length + 1})`);
      params.push(`%${search.trim()}%`);
    }

    const whereClause = conditionClauses.length ? ` WHERE ${conditionClauses.join(" AND ")}` : "";

    // Lead Scoring & Quality query check
    let leads = [];
    if (quality) {
      const preferredKeywords = (process.env.PREFERRED_COMPANY_KEYWORDS || '')
        .toLowerCase()
        .split(',')
        .map(k => k.trim())
        .filter(Boolean);

      let scoreExp = '0';
      if (preferredKeywords.length > 0) {
        const likes = preferredKeywords.map(k => {
          const safeK = k.replace(/'/g, "''");
          return `(COALESCE(company, '') ILIKE '%${safeK}%' OR COALESCE(title, '') ILIKE '%${safeK}%')`;
        }).join(' OR ');
        scoreExp += ` + (CASE WHEN ${likes} THEN 50 ELSE 0 END)`;
      }

      const qualityQuery = `
          WITH scored_leads AS (
            SELECT *,
              (${scoreExp}) AS score
            FROM leads
            ${whereClause}
          ),
          ranked_leads AS (
             SELECT *,
               PERCENT_RANK() OVER (ORDER BY score DESC, created_at DESC) as pct_rank
             FROM scored_leads
          )
          SELECT * FROM ranked_leads
          WHERE 
            CASE 
              WHEN $${params.length + 1} = 'primary' THEN pct_rank <= 0.20
              WHEN $${params.length + 1} = 'secondary' THEN pct_rank > 0.20 AND pct_rank <= 0.50
              WHEN $${params.length + 1} = 'tertiary' THEN pct_rank > 0.50
            END
          ORDER BY score DESC, created_at DESC
        `;
      const qResult = await pool.query(qualityQuery, [...params, quality]);
      leads = qResult.rows;
    } else {
      const dataQuery = `SELECT * FROM leads ${whereClause} ORDER BY created_at DESC`;
      const result = await pool.query(dataQuery, params);
      leads = result.rows;
    }

    if (format === 'xlsx') {
      let xlsx;
      try {
        const module = await import('xlsx');
        xlsx = module.default || module;
      } catch (e) {
        console.error("❌ xlsx library not found. Please run 'npm install xlsx'");
        return res.status(500).json({ error: "Excel export capability is currently unavailable on the server." });
      }

      // Format dates for Excel
      const xlsxData = leads.map(l => ({
        ...l,
        created_at: l.created_at ? new Date(l.created_at).toLocaleString() : '',
        updated_at: l.updated_at ? new Date(l.updated_at).toLocaleString() : ''
      }));

      const worksheet = xlsx.utils.json_to_sheet(xlsxData);
      const workbook = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(workbook, worksheet, "Leads");

      // Use helper to output buffer
      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=leads_export_${new Date().toISOString().split('T')[0]}.xlsx`);
      return res.status(200).send(buffer);
    } else {
      // Default CSV Export
      const fields = [
        'full_name', 'first_name', 'last_name', 'title', 'company', 'location',
        'linkedin_url', 'email', 'phone', 'source', 'status', 'review_status', 'created_at'
      ];

      let csv = fields.join(',') + '\n';
      leads.forEach(lead => {
        const row = fields.map(field => {
          let val = lead[field] === null || lead[field] === undefined ? '' : String(lead[field]);
          // Basic CSV escaping
          val = val.replace(/"/g, '""');
          if (val.search(/("|,|\n)/g) >= 0) val = `"${val}"`;
          return val;
        });
        csv += row.join(',') + '\n';
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=leads_export_${new Date().toISOString().split('T')[0]}.csv`);
      return res.status(200).send(csv);
    }
  } catch (err) {
    console.error('❌ Export error:', err);
    res.status(500).json({ error: err.message });
  }
}
