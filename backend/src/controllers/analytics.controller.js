import pool from "../db.js";
import { INDUSTRY_KEYWORDS as industryKeywords, SUB_INDUSTRY_KEYWORDS } from '../config/industries.js';

// Simple in-memory cache for LinkedIn industry metadata
let INDUSTRY_METADATA_CACHE = null;

/**
 * Load LinkedIn industry metadata from database
 * Replaces the old CSV-based approach
 */
async function loadIndustryMetadata() {
  if (INDUSTRY_METADATA_CACHE) return INDUSTRY_METADATA_CACHE;

  try {
    // Query all industries from database
    const result = await pool.query(`
      SELECT code, name, hierarchy, description, top_level_industry, sub_category
      FROM linkedin_industries
      ORDER BY code
    `);

    const topLevel = {};
    const subcategoriesByTop = {};

    for (const row of result.rows) {
      const topName = row.top_level_industry;
      if (!topName) continue;

      // Build top-level industry map
      if (!topLevel[topName]) {
        topLevel[topName] = {
          code: row.code,
          name: topName,
          description: row.description,
        };
      }

      // Build sub-categories map
      if (row.sub_category) {
        const subName = row.sub_category;
        if (!subcategoriesByTop[topName]) {
          subcategoriesByTop[topName] = {};
        }
        if (!subcategoriesByTop[topName][subName]) {
          subcategoriesByTop[topName][subName] = {
            code: row.code,
            name: subName,
            description: row.description,
          };
        }
      }
    }

    INDUSTRY_METADATA_CACHE = { topLevel, subcategoriesByTop };
  } catch (err) {
    console.error(
      "[analytics.controller] Failed to load LinkedIn industry metadata from database:",
      err.message
    );
    INDUSTRY_METADATA_CACHE = {
      topLevel: {},
      subcategoriesByTop: {},
    };
  }

  return INDUSTRY_METADATA_CACHE;
}

// Map period to SQL interval or specific date range
function getDateRange(period, month, year) {
  const now = new Date();
  let start, end;

  if (period === "daily") {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  } else if (period === "weekly") {
    const day = now.getDay() || 7;
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
    end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  } else if (period === "monthly") {
    const targetMonth = month !== undefined ? parseInt(month, 10) : now.getMonth();
    const targetYear = year !== undefined ? parseInt(year, 10) : now.getFullYear();
    start = new Date(targetYear, targetMonth, 1);
    end = new Date(targetYear, targetMonth + 1, 1);
  } else if (period === "yearly") {
    const targetYear = year !== undefined ? parseInt(year, 10) : now.getFullYear();
    start = new Date(targetYear, 0, 1);
    end = new Date(targetYear + 1, 0, 1);
  } else {
    // Default 30 days
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    end = new Date();
  }

  return { start, end };
}

// Build connection_degree SQL filter (whitelist: 1st, 2nd, 3rd)
// Matches common formats: 1st, 2nd, 3rd, 1, 2, 3, first, second, third, 1st degree, etc.
function getConnectionDegreeClause(columnPrefix = '') {
  return (degree) => {
    const raw = degree;
    const d = (raw == null ? '' : String(raw)).trim().toLowerCase();
    const col = columnPrefix ? `${columnPrefix}.connection_degree` : 'connection_degree';
    // Use COALESCE to handle NULL; wrap in parentheses for OR logic
    if (d === '1st' || d === '1') return ` AND (${col} ILIKE '%1st%' OR ${col} ILIKE '%first%' OR LOWER(TRIM(COALESCE(${col}, ''))) = '1')`;
    if (d === '2nd' || d === '2') return ` AND (${col} ILIKE '%2nd%' OR ${col} ILIKE '%second%' OR LOWER(TRIM(COALESCE(${col}, ''))) = '2')`;
    if (d === '3rd' || d === '3') return ` AND (${col} ILIKE '%3rd%' OR ${col} ILIKE '%third%' OR LOWER(TRIM(COALESCE(${col}, ''))) = '3')`;
    return '';
  };
}

// GET /api/analytics/dashboard
// Returns all dashboard analytics: lead scraping + campaign metrics, with optional period and connection_degree filter
// scope: 'my_contacts' (default) = only is_priority leads; 'all' = all leads
export async function getDashboardAnalytics(req, res) {
  try {
    const { period = "monthly", connection_degree, month, year, scope = "my_contacts" } = req.query;
    const rawDegree = Array.isArray(connection_degree) ? connection_degree[0] : connection_degree;
    const scopeFilter = (scope === "all" || scope === "all_leads") ? "" : " AND is_priority = TRUE";

    const now = new Date();
    const { start, end } = getDateRange(period, month, year);
    const dateFilter = `created_at >= $1 AND created_at < $2`;
    const activityDateFilter = `last_activity_at >= $1 AND last_activity_at < $2`;

    // When filtering by connection_degree, use at least a wide lookback so we find leads
    // (many leads with connection_degree may have been imported outside the selected period)
    const rawDegreeStart = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const effectiveStart = rawDegree ? rawDegreeStart : start;
    const effectiveLeadParam = [effectiveStart, end];

    const connFilter = getConnectionDegreeClause()(rawDegree);
    const connFilterLeads = getConnectionDegreeClause('l')(rawDegree);

    const leadWhere = `${dateFilter}${connFilter}${scopeFilter}`;
    const leadWhereParams = effectiveLeadParam;

    // —— Lead Scraping & Extraction ——
    const totalLeads = await pool.query(
      `SELECT COUNT(*) AS count FROM leads WHERE ${leadWhere}`,
      leadWhereParams
    );
    const sourceBreakdown = await pool.query(
      `SELECT source, COUNT(*) AS count FROM leads WHERE ${leadWhere} GROUP BY source`,
      leadWhereParams
    );
    const sourceCount = sourceBreakdown.rows.reduce((acc, row) => {
      acc[row.source || "unknown"] = parseInt(row.count, 10);
      return acc;
    }, {});
    const withPhone = await pool.query(
      `SELECT COUNT(*) AS count FROM leads WHERE phone IS NOT NULL AND TRIM(phone) != '' AND ${leadWhere}`,
      leadWhereParams
    );
    const withEmail = await pool.query(
      `SELECT COUNT(*) AS count FROM leads WHERE email IS NOT NULL AND TRIM(email) != '' AND ${leadWhere}`,
      leadWhereParams
    );
    const actionableLeads = await pool.query(
      `SELECT COUNT(*) AS count FROM leads WHERE status = $3 AND ${leadWhere}`,
      [...leadWhereParams, "approved"]
    );

    // Load LinkedIn industry hierarchy (top-level + sub-categories) for industry distribution
    const { topLevel: industryMetaTop, subcategoriesByTop } =
      await loadIndustryMetadata();

    // Industry-wise distribution using shared config
    // Using the imported industryKeywords

    const industryCounts = {};
    const subIndustryCounts = {}; // { [topIndustry]: { [subName]: count } }
    // Initialize all industries with 0
    Object.keys(industryKeywords).forEach(industry => {
      industryCounts[industry] = 0;
    });

    const leadsForIndustry = await pool.query(
      `SELECT id, COALESCE(company,'') AS company, COALESCE(title,'') AS title FROM leads WHERE ${leadWhere}`,
      leadWhereParams
    );

    // ── Industry Classification Loop ──────────────────────────────────────────
    // Pure classification — no scoring (scoring happens at ingestion / on prefs save).
    for (const row of leadsForIndustry.rows) {
      const text = `${(row.company || '').toLowerCase()} ${(row.title || '').toLowerCase()}`;
      let matchedIndustry = null;

      for (const [industry, keywords] of Object.entries(industryKeywords)) {
        if (keywords.some((k) => text.includes(k.toLowerCase()))) {
          industryCounts[industry] = (industryCounts[industry] || 0) + 1;
          matchedIndustry = industry;
          break;
        }
      }

      if (!matchedIndustry) {
        industryCounts['Other'] = (industryCounts['Other'] || 0) + 1;
      } else {
        // Resolve sub-category
        let matchedSubName = null;
        const dbLookupKeys = [
          matchedIndustry,
          { 'Technology, Information and Media': 'Technology' }[matchedIndustry],
          { 'Hospitals and Health Care': 'Hospital & Health Care' }[matchedIndustry],
        ].filter(Boolean);

        for (const key of dbLookupKeys) {
          const subMetaForIndustry = subcategoriesByTop[key];
          if (subMetaForIndustry) {
            for (const [subName, meta] of Object.entries(subMetaForIndustry)) {
              const tokens = (meta.name || '')
                .toLowerCase()
                .split(/[\s,&\/-]+/)
                .filter((t) => t.length > 2);
              if (tokens.length && tokens.some((t) => text.includes(t))) {
                matchedSubName = subName;
                break;
              }
            }
            if (matchedSubName) break;
          }
        }

        if (!matchedSubName && SUB_INDUSTRY_KEYWORDS[matchedIndustry]) {
          const subs = SUB_INDUSTRY_KEYWORDS[matchedIndustry];
          for (const sub of subs) {
            const kw = sub.keywords || [];
            if (kw.some((k) => text.includes(k.toLowerCase()))) {
              matchedSubName = sub.name;
              break;
            }
          }
        }

        if (matchedSubName) {
          if (!subIndustryCounts[matchedIndustry]) subIndustryCounts[matchedIndustry] = {};
          subIndustryCounts[matchedIndustry][matchedSubName] =
            (subIndustryCounts[matchedIndustry][matchedSubName] || 0) + 1;
        }
      }
    }

    // ── Lead Quality Distribution (primary/secondary/tertiary; respects scope) ──────
    const tierResult = await pool.query(
      `SELECT COALESCE(manual_tier, preference_tier, 'tertiary') AS effective_tier, COUNT(*) AS cnt
         FROM leads
        WHERE ${leadWhere}
        GROUP BY COALESCE(manual_tier, preference_tier, 'tertiary')`,
      leadWhereParams
    );

    let primaryCount = 0;
    let secondaryCount = 0;
    let tertiaryCount = 0;

    for (const row of tierResult.rows) {
      const c = parseInt(row.cnt, 10);
      const tier = (row.effective_tier || '').toLowerCase();
      if (tier === 'primary') primaryCount = c;
      else if (tier === 'secondary') secondaryCount = c;
      else tertiaryCount += c;
    }

    const totalScored = primaryCount + secondaryCount + tertiaryCount;


    const industryDistribution = Object.entries(industryCounts)
      .map(([name, count]) => {
        const subCounts = subIndustryCounts[name] || {};
        const subCategories = Object.entries(subCounts)
          .map(([subName, subCount]) => ({
            name: subName,
            count: subCount,
            code:
              subcategoriesByTop[name]?.[subName]?.code ||
              null,
          }))
          .filter((s) => s.count > 0)
          .sort((a, b) => {
            const isOtherA = a.name === "Other" || a.name === "Others";
            const isOtherB = b.name === "Other" || b.name === "Others";
            if (isOtherA && !isOtherB) return 1;
            if (!isOtherA && isOtherB) return -1;
            return b.count - a.count;
          });

        if (req.query.preferences === 'true' && name === 'Other') {
          return null;
        }

        return {
          industry: name,
          count,
          code: industryMetaTop[name]?.code || null,
          subCategories,
        };
      })
      .filter(item => item && item.count > 0) // Only include valid industries with leads
      .sort((a, b) => {
        const isOtherA = a.industry === "Other" || a.industry === "Others";
        const isOtherB = b.industry === "Other" || b.industry === "Others";
        if (isOtherA && !isOtherB) return 1;
        if (!isOtherA && isOtherB) return -1;
        return b.count - a.count;
      }); // Sort by count descending, but keep 'Other' last

    // Extraction by period (leads created in last interval)
    const extractionByPeriod = await pool.query(
      `SELECT COUNT(*) AS count FROM leads WHERE ${leadWhere}`,
      leadWhereParams
    );

    // Connection type breakdown
    const connectionBreakdownResult = await pool.query(`
      SELECT
        connection_degree,
        COUNT(*) as count
      FROM leads
      WHERE connection_degree IS NOT NULL AND connection_degree != '' AND ${leadWhere}
      GROUP BY connection_degree
    `, leadWhereParams);

    const connectionBreakdown = {
      firstDegree: 0,
      secondDegree: 0,
      thirdDegree: 0,
    };

    // Map the results to our breakdown object
    connectionBreakdownResult.rows.forEach(row => {
      const degree = (row.connection_degree || '').toLowerCase().trim();
      const count = parseInt(row.count, 10);

      if (degree.includes('1st') || degree === '1') {
        connectionBreakdown.firstDegree += count;
      } else if (degree.includes('2nd') || degree === '2') {
        connectionBreakdown.secondDegree += count;
      } else if (degree.includes('3rd') || degree === '3') {
        connectionBreakdown.thirdDegree += count;
      }
    });

    // —— Campaign Analytics ——
    // When connection_degree filter is active, restrict to campaigns that have leads in that degree
    const campaignLeadFilter = connFilterLeads
      ? ` AND id IN (SELECT DISTINCT cl.campaign_id FROM campaign_leads cl JOIN leads l ON cl.lead_id = l.id WHERE 1=1${connFilterLeads})`
      : '';
    const campaignStatus = await pool.query(`
      SELECT status, COUNT(*) AS count FROM campaigns WHERE ${dateFilter}${campaignLeadFilter} GROUP BY status
    `, effectiveLeadParam);
    const statusCounts = campaignStatus.rows.reduce((acc, row) => {
      acc[row.status] = parseInt(row.count, 10);
      return acc;
    }, {});
    const activeCampaigns = statusCounts.active || 0;
    const completedCampaigns = statusCounts.completed || 0;
    const scheduledCampaigns = await pool.query(`
      SELECT COUNT(*) AS count FROM campaigns
      WHERE status = $3 AND schedule_start > NOW() AND ${dateFilter}${campaignLeadFilter}
    `, [...effectiveLeadParam, "draft"]).then((r) => parseInt(r.rows[0]?.count || 0, 10));

    // Get messages sent count (campaign_leads with status sent, replied, or completed)
    // When connection_degree filter is active, only count campaign_leads where lead matches
    const messagesSentResult = await pool.query(`
        SELECT COUNT(*) AS count FROM campaign_leads cl
        ${connFilterLeads ? 'JOIN leads l ON cl.lead_id = l.id' : ''}
        WHERE cl.status IN ('sent', 'replied', 'completed') AND cl.${activityDateFilter.replace(/last_activity_at/g, 'last_activity_at')}${connFilterLeads ? connFilterLeads : ''}
    `, effectiveLeadParam);
    const totalMessagesSent = parseInt(messagesSentResult.rows[0]?.count || 0, 10);

    // Campaign types breakdown - group by type, NULL types show as messages_sent
    const campaignTypesResult = await pool.query(`
      SELECT 
        CASE 
          WHEN type IS NULL OR type = '' THEN 'messages_sent'
          ELSE type
        END AS type,
        COUNT(*) AS count 
      FROM campaigns 
      WHERE ${dateFilter}${campaignLeadFilter}
      GROUP BY 
        CASE 
          WHEN type IS NULL OR type = '' THEN 'messages_sent'
          ELSE type
        END
      ORDER BY count DESC
    `, effectiveLeadParam);

    // Build type breakdown
    const typeBreakdown = {};
    campaignTypesResult.rows.forEach(row => {
      const type = row.type;
      const count = parseInt(row.count || 0, 10);

      if (type === 'messages_sent') {
        // For messages_sent, use actual messages sent count
        typeBreakdown.messages_sent = totalMessagesSent > 0 ? totalMessagesSent : count;
      } else {
        typeBreakdown[type] = count;
      }
    });

    // If no campaigns exist but we have messages sent, show it
    if (Object.keys(typeBreakdown).length === 0 && totalMessagesSent > 0) {
      typeBreakdown.messages_sent = totalMessagesSent;
    }

    const repliesResult = await pool.query(`
        SELECT COUNT(*) AS count FROM campaign_leads cl
        ${connFilterLeads ? 'JOIN leads l ON cl.lead_id = l.id' : ''}
        WHERE cl.status = $3 AND cl.${activityDateFilter.replace(/last_activity_at/g, 'last_activity_at')}${connFilterLeads ? connFilterLeads : ''}
    `, [...effectiveLeadParam, "replied"]);

    const totalSent = parseInt(messagesSentResult.rows[0]?.count || 0, 10);
    const totalReplied = parseInt(repliesResult.rows[0]?.count || 0, 10);
    const engagementLevel = totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) : 0;

    // Campaign totals by period (campaigns created in interval)
    const campaignsByPeriod = await pool.query(
      `SELECT COUNT(*) AS count FROM campaigns WHERE ${dateFilter}${campaignLeadFilter}`,
      effectiveLeadParam
    );
    const campaignLeadsByPeriod = await pool.query(`
        SELECT COUNT(*) AS count FROM campaign_leads cl
        ${connFilterLeads ? 'JOIN leads l ON cl.lead_id = l.id' : ''}
        WHERE cl.created_at >= $1 AND cl.created_at < $2${connFilterLeads ? connFilterLeads : ''}
      `, effectiveLeadParam);

    const messagesSentByPeriod = await pool.query(`
        SELECT COUNT(*) AS count FROM campaign_leads cl
        ${connFilterLeads ? 'JOIN leads l ON cl.lead_id = l.id' : ''}
        WHERE cl.status IN ('sent', 'replied', 'completed') AND cl.last_activity_at >= $1 AND cl.last_activity_at < $2${connFilterLeads ? connFilterLeads : ''}
      `, effectiveLeadParam);

    const response = {
      period,
      scope: scope === "all" || scope === "all_leads" ? "all" : "my_contacts",
      leadScraping: {
        totalLeads: parseInt(totalLeads.rows[0]?.count || 0, 10),
        sourceCount,
        leadsWithPhone: parseInt(withPhone.rows[0]?.count || 0, 10),
        leadsWithEmail: parseInt(withEmail.rows[0]?.count || 0, 10),
        actionableLeads: parseInt(actionableLeads.rows[0]?.count || 0, 10),
        industryDistribution,
        extractionByPeriod: {
          count: parseInt(extractionByPeriod.rows[0]?.count || 0, 10),
          interval: `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`,
        },
        connectionBreakdown: {
          firstDegree: connectionBreakdown.firstDegree,
          secondDegree: connectionBreakdown.secondDegree,
          thirdDegree: connectionBreakdown.thirdDegree,
        },
        leadQuality: {
          primary: primaryCount,
          secondary: secondaryCount,
          tertiary: tertiaryCount,
          totalScored: totalScored
        },
      },
      campaignAnalytics: {
        statusOverview: {
          active: activeCampaigns,
          completed: completedCampaigns,
          scheduled: scheduledCampaigns,
          draft: statusCounts.draft || 0,
        },
        typeBreakdown: typeBreakdown,
        messaging: {
          messagesSent: totalSent,
          repliesReceived: totalReplied,
          engagementPercent: engagementLevel,
        },
        totalsByPeriod: {
          campaigns: parseInt(campaignsByPeriod.rows[0]?.count || 0, 10),
          leadsAdded: parseInt(campaignLeadsByPeriod.rows[0]?.count || 0, 10),
          messagesSent: parseInt(messagesSentByPeriod.rows[0]?.count || 0, 10),
          engagement: totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) : 0,
        },
      },
    };

    return res.json(response);
  } catch (err) {
    console.error("Dashboard analytics error:", err);
    res.status(500).json({ error: err.message });
  }
}
