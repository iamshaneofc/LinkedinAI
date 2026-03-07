// backend/src/controllers/phantom.controller.js

import phantomService from "../services/phantombuster.service.js";
import { createToken } from "../services/messageCsvStore.js";
import { exportLeadsToCSV } from "../services/csvExporter.js";
import { parsePhantomResults } from "../services/phantomParser.js";
import { saveLead } from "../services/lead.service.js";
import { getSearchCriteriaFromCrm, pushLeadsToCrm, isCrmConfigured } from "../services/crm.service.js";
import { buildLinkedInSearchUrl, buildSearchQueryFromCriteria } from "../utils/linkedinSearchUrl.js";
import pool from "../db.js";
import { NotificationService } from "../services/notification.service.js";

// Link shown to user when sign-in or connection needs to be refreshed (no technical wording in UI)
const FIX_CONNECTION_URL = "https://app.phantombuster.com";

/**
 * Builds the JSON payload (and status) for a phantom error. Used by handlePhantomError and by
 * campaign launch so the same user-friendly message + link are returned everywhere.
 * @returns {{ status: number, payload: object } | null} null if not a recognized phantom error
 */
export function getPhantomErrorPayload(error) {
  const msg = String(error.message || "");

  // Sign-in expired or session/cookie missing — user-friendly message + link only
  if (
    (/^PB_/.test(error.code) || !error.code) &&
    /cookie|session|li_at|login|expir/i.test(msg)
  ) {
    return {
      status: 400,
      payload: {
        success: false,
        code: "PB_COOKIE_MISSING",
        message: "Your sign-in has expired. Please sign in again to continue.",
        tips: ["Use the link below to reconnect your account, then try again."],
        helpUrl: FIX_CONNECTION_URL,
      },
    };
  }

  // LinkedIn / Sales Navigator monthly quota exhausted
  if (error.code === "PB_LINKEDIN_QUOTA_EXCEEDED") {
    return {
      status: 429,
      payload: {
        success: false,
        code: error.code,
        message: "Search limit reached for this month. You can try again after it resets or use a different account.",
        tips: [
          "Use the link below to check your account and limits.",
          "You can still work with leads already in the app.",
        ],
        helpUrl: FIX_CONNECTION_URL,
      },
    };
  }

  // Agent doesn't exist / wrong ID
  if (error.code === "PB_AGENT_NOT_FOUND") {
    return {
      status: 400,
      payload: {
        success: false,
        code: error.code,
        message: "The connection to your automation could not be found. Please check your setup.",
        tips: ["Use the link below to open your dashboard and reconnect the automation."],
        helpUrl: FIX_CONNECTION_URL,
        configuredAgentIds: {
          SEARCH_EXPORT_PHANTOM_ID: process.env.SEARCH_EXPORT_PHANTOM_ID || process.env.SEARCH_LEADS_PHANTOM_ID || null,
          CONNECTIONS_EXPORT_PHANTOM_ID: process.env.CONNECTIONS_EXPORT_PHANTOM_ID || null,
          PROFILE_SCRAPER_PHANTOM_ID: process.env.PROFILE_SCRAPER_PHANTOM_ID || null,
          MESSAGE_SENDER_PHANTOM_ID: process.env.MESSAGE_SENDER_PHANTOM_ID || process.env.LINKEDIN_MESSAGE_PHANTOM_ID || process.env.PHANTOM_MESSAGE_SENDER_ID || null
        },
      },
    };
  }

  // Max parallelism (already running)
  if (error.code === "PB_MAX_PARALLELISM") {
    return {
      status: 429,
      payload: {
        success: false,
        code: error.code,
        message: "A run is already in progress. Please wait for it to finish, or stop it first.",
        tips: ["Use the link below to view and manage running tasks."],
        helpUrl: FIX_CONNECTION_URL,
      },
    };
  }

  // Network
  if (error.code === "PB_NETWORK_ERROR") {
    return {
      status: 502,
      payload: {
        success: false,
        code: error.code,
        message: "We couldn’t reach the service. Please try again in a minute.",
        helpUrl: FIX_CONNECTION_URL,
      },
    };
  }

  // Argument invalid (e.g. run once from dashboard first)
  if (
    (error.code === "PB_UNKNOWN_ERROR" || !error.code) &&
    /argument-invalid|argument invalid/i.test(msg)
  ) {
    return {
      status: 400,
      payload: {
        success: false,
        code: "PB_ARGUMENT_INVALID",
        message: "Setup isn’t complete yet. Run it once from the link below, then try again here.",
        tips: ["Open the link below, run the automation once there, then come back and try again."],
        helpUrl: FIX_CONNECTION_URL,
      },
    };
  }

  // Fallback: still add the link so user has a place to fix things
  const message = error.message || "Something went wrong. Try again or use the link below to check your account.";
  return {
    status: 500,
    payload: {
      success: false,
      code: error.code || "PB_UNKNOWN_ERROR",
      message,
      helpUrl: FIX_CONNECTION_URL,
      ...(error.details && { details: error.details }),
      ...(process.env.NODE_ENV === "development" && error.stack && { stack: error.stack }),
    },
  };
}

// Centralized helper to map PhantomBuster errors into clear API responses
function handlePhantomError(res, context, error) {
  console.error(`❌ ${context} error:`, error.message);

  const result = getPhantomErrorPayload(error);
  if (result) {
    return res.status(result.status).json(result.payload);
  }

  const message = error.message || "Something went wrong. Try again or use the link below to check your account.";
  return res.status(500).json({
    success: false,
    code: error.code || "PB_UNKNOWN_ERROR",
    message,
    helpUrl: FIX_CONNECTION_URL,
    ...(error.details && { details: error.details }),
    ...(process.env.NODE_ENV === "development" && error.stack && { stack: error.stack })
  });
}

// ============================================
// 1. EXPORT CONNECTIONS (ONE-CLICK)
// ============================================
export async function exportConnectionsComplete(req, res) {
  try {
    console.log("\n🎯 === FULL CONNECTION EXPORT STARTED ===\n");

    // Step 1: Launch and wait
    const result = await phantomService.exportConnections();

    if (result.data.length === 0) {
      // Provide helpful guidance if no data found
      return res.json({
        success: false,
        message: "No connections found in PhantomBuster result",
        totalLeads: 0,
        containerId: result.containerId,
        tips: [
          "The phantom completed but no result data was found.",
          "This might happen if PhantomBuster's storage is private (403 Forbidden).",
          "You can manually import results using the /api/phantom/import-results endpoint:",
          "POST /api/phantom/import-results with body: { resultUrl: 'https://cache1.phantombooster.com/.../result.json' }",
          "Or check the PhantomBuster dashboard for container " + result.containerId + " and copy the result URL."
        ]
      });
    }

    // Step 2: Parse leads
    const leads = parsePhantomResults(result.data);
    console.log(`✅ Parsed ${leads.length} leads`);

    // Step 3: Save to database with source = connections_export (classified for CRM)
    const leadSource = "connections_export";
    let savedCount = 0;
    const savedLeadIds = [];
    for (const lead of leads) {
      try {
        // Connection Export phantom exports 1st-degree connections only
        // If connectionDegree is missing, default to "1st"
        const connectionDegree = lead.connectionDegree || "1st";
        const saved = await saveLead({ ...lead, source: leadSource, connectionDegree });
        if (saved) {
          savedCount++;
          if (saved.id) savedLeadIds.push(saved.id);
        }
      } catch (err) {
        console.error("Error saving lead:", err.message);
      }
    }

    // Step 4: Export to CSV
    const { filepath, filename } = exportLeadsToCSV(leads);

    // Step 5: Log to import_logs so it appears in Imports & Activity Log
    try {
      await pool.query(
        `INSERT INTO import_logs (source, container_id, total_leads, saved, duplicates, csv_file, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          leadSource,
          result.containerId || null,
          leads.length,
          savedCount,
          leads.length - savedCount,
          filename || null
        ]
      );
    } catch (err) {
      console.error("Failed to log import:", err.message);
    }

    console.log("\n✅ === EXPORT COMPLETED ===");
    console.log(`   Total: ${leads.length}`);
    console.log(`   Saved: ${savedCount}`);
    console.log(`   Duplicates: ${leads.length - savedCount}`);
    console.log(`   CSV: ${filename}\n`);

    const deepLink = savedLeadIds.length > 0
      ? `/connections?ids=${savedLeadIds.join(',')}&highlight=${savedLeadIds.join(',')}`
      : '/connections';
    try {
      await NotificationService.create({
        type: 'phantom_completed',
        title: 'Connections export completed',
        message: `Extracted ${savedCount} new connections from LinkedIn`,
        data: {
          source: leadSource,
          containerId: result.containerId || null,
          totalLeads: leads.length,
          saved: savedCount,
          duplicates: leads.length - savedCount,
          csvFile: filename,
          link: deepLink,
          leadIds: savedLeadIds,
        },
      });
    } catch (notifyErr) {
      console.error('NotificationService (exportConnectionsComplete) error:', notifyErr.message);
    }

    return res.json({
      success: true,
      message: "Connection export completed",
      totalLeads: leads.length,
      savedToDatabase: savedCount,
      duplicates: leads.length - savedCount,
      csvFile: filename,
      csvPath: filepath
    });

  } catch (error) {
    return handlePhantomError(res, "Export", error);
  }
}

// ============================================
// 2. SEARCH LEADS (ONE-CLICK)
// ============================================
export async function searchLeadsComplete(req, res) {
  try {
    console.log("\n🎯 === SEARCH & IMPORT REQUEST RECEIVED (search-leads-complete) ===\n");
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const { query, limit } = body;
    // Only pass meta when user explicitly sent them – otherwise phantom uses its saved search / default
    const hasQuery = query != null && typeof query === "string" && query.trim() !== "";
    const hasLimit = limit != null && limit !== "" && Number.isFinite(parseInt(limit, 10)) && parseInt(limit, 10) > 0;
    const searchQuery = hasQuery ? String(query).trim() : null;
    const searchLimit = hasLimit ? parseInt(limit, 10) : null;

    console.log("🎯 FULL LEAD SEARCH: launching PhantomBuster Search Export phantom...");
    console.log(`   Meta from app: ${!hasQuery && !hasLimit ? "NONE (phantom uses saved search & default limit)" : ""}`);
    if (hasQuery) console.log(`   Query: "${searchQuery}"`);
    if (hasLimit) console.log(`   Limit: ${searchLimit}\n`);

    // Step 1: Launch and wait – no search/limit args when not provided so PhantomBuster uses saved config
    const result = await phantomService.searchLeads(searchQuery, searchLimit);

    const data = Array.isArray(result?.data) ? result.data : [];
    if (data.length === 0) {
      return res.json({
        success: true,
        message: "No leads found",
        totalLeads: 0
      });
    }

    // Step 2: Parse leads
    const leads = parsePhantomResults(data);
    console.log(`✅ Parsed ${leads.length} leads`);

    // Step 3: Save to database with source = search_export (classified for CRM)
    const leadSource = "search_export";
    let savedCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;
    const savedLeadIds = [];

    console.log(`\n💾 Saving ${leads.length} leads to database...`);
    for (const lead of leads) {
      try {
        const saved = await saveLead({ ...lead, source: leadSource });
        if (saved) {
          savedCount++;
          if (saved.id) savedLeadIds.push(saved.id);
        } else {
          duplicateCount++;
        }
      } catch (err) {
        errorCount++;
        console.error(`❌ Error saving lead ${lead.linkedinUrl}:`, err.message);
      }
    }

    console.log(`✅ Save complete: ${savedCount} new, ${duplicateCount} duplicates, ${errorCount} errors`);

    // Step 4: Export to CSV
    const { filepath, filename } = exportLeadsToCSV(leads);

    // Step 5: Log to import_logs so it appears in Imports & Activity Log
    try {
      await pool.query(
        `INSERT INTO import_logs (source, container_id, total_leads, saved, duplicates, csv_file, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          leadSource,
          result.containerId || null,
          leads.length,
          savedCount,
          leads.length - savedCount,
          filename || null
        ]
      );
    } catch (err) {
      console.error("Failed to log import:", err.message);
    }

    // Step 6: Push to external CRM (if configured)
    let pushedToCrm = 0;
    try {
      const crmResult = await pushLeadsToCrm(leads);
      pushedToCrm = crmResult.pushed ?? 0;
      if (crmResult.error) {
        console.log(`⚠️ CRM push error (leads still saved to DB): ${crmResult.error}`);
      } else if (pushedToCrm > 0) {
        console.log(`✅ Pushed ${pushedToCrm} leads to CRM`);
      }
    } catch (crmErr) {
      console.error("Failed to push to CRM:", crmErr.message);
    }

    console.log("\n✅ === SEARCH COMPLETED ===");
    console.log(`   Query: ${searchQuery || "(none)"}`);
    console.log(`   Total: ${leads.length}`);
    console.log(`   Saved: ${savedCount}`);
    if (pushedToCrm > 0) console.log(`   Pushed to CRM: ${pushedToCrm}`);
    console.log(`   CSV: ${filename}\n`);

    const searchDeepLink = savedLeadIds.length > 0
      ? `/connections?ids=${savedLeadIds.join(',')}&highlight=${savedLeadIds.join(',')}`
      : '/connections';
    try {
      await NotificationService.create({
        type: 'phantom_completed',
        title: 'Lead search completed',
        message: `Imported ${savedCount} leads from LinkedIn search`,
        data: {
          source: leadSource,
          containerId: result.containerId || null,
          query: searchQuery || null,
          totalLeads: leads.length,
          saved: savedCount,
          duplicates: leads.length - savedCount,
          pushedToCrm,
          csvFile: filename,
          link: searchDeepLink,
          leadIds: savedLeadIds,
        },
      });
    } catch (notifyErr) {
      console.error('NotificationService (searchLeadsComplete) error:', notifyErr.message);
    }

    return res.json({
      success: true,
      message: "Lead search completed",
      query: searchQuery || null,
      totalLeads: leads.length,
      savedToDatabase: savedCount,
      duplicates: leads.length - savedCount,
      pushedToCrm: pushedToCrm,
      csvFile: filename,
      csvPath: filepath
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(error?.message || String(error));
    if (error?.code) err.code = error.code;
    if (error?.details) err.details = error.details;
    console.error("❌ Search & Import error:", err.message);
    console.error(err.stack);
    return handlePhantomError(res, "Search", err);
  }
}

// ============================================
// 2B. IMPORT BY CONTAINER ID (run phantom in PhantomBuster, then paste container ID here)
// ============================================
export async function importByContainerId(req, res) {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const containerId = body.containerId ?? body.container_id ?? body.containerID;
    if (!containerId || String(containerId).trim() === "") {
      return res.status(400).json({
        success: false,
        code: "MISSING_CONTAINER_ID",
        message: "containerId is required. Run the phantom in PhantomBuster, then paste the container/run ID here.",
        example: { containerId: "1234567890123456" }
      });
    }

    const result = await phantomService.importResultsByContainerId(String(containerId).trim());
    const data = Array.isArray(result?.data) ? result.data : [];
    if (data.length === 0) {
      return res.json({
        success: true,
        message: "No leads found in this container. The run may still be in progress or produced no results.",
        totalLeads: 0,
        savedToDatabase: 0,
        duplicates: 0,
        containerId: result.containerId
      });
    }

    const leads = parsePhantomResults(data);
    const leadSource = "search_export";
    let savedCount = 0;
    const savedLeadIds = [];
    for (const lead of leads) {
      try {
        const saved = await saveLead({ ...lead, source: leadSource });
        if (saved) {
          savedCount++;
          if (saved.id) savedLeadIds.push(saved.id);
        }
      } catch (err) {
        console.error("Error saving lead:", err.message);
      }
    }

    const { filepath, filename } = exportLeadsToCSV(leads);
    try {
      await pool.query(
        `INSERT INTO import_logs (source, container_id, total_leads, saved, duplicates, csv_file, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [leadSource, result.containerId, leads.length, savedCount, leads.length - savedCount, filename || null]
      );
    } catch (err) {
      console.error("Failed to log import:", err.message);
    }

    const containerDeepLink = savedLeadIds.length > 0
      ? `/connections?ids=${savedLeadIds.join(',')}&highlight=${savedLeadIds.join(',')}`
      : '/connections';
    try {
      await NotificationService.create({
        type: 'phantom_completed',
        title: 'Leads imported from PhantomBuster',
        message: `Imported ${savedCount} leads from container ${result.containerId}`,
        data: {
          source: leadSource,
          containerId: result.containerId,
          totalLeads: leads.length,
          saved: savedCount,
          duplicates: leads.length - savedCount,
          csvFile: filename,
          link: containerDeepLink,
          leadIds: savedLeadIds,
        },
      });
    } catch (notifyErr) {
      console.error('NotificationService (importByContainerId) error:', notifyErr.message);
    }

    return res.json({
      success: true,
      message: "Leads imported from container",
      totalLeads: leads.length,
      savedToDatabase: savedCount,
      duplicates: leads.length - savedCount,
      csvFile: filename,
      csvPath: filepath,
      containerId: result.containerId
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(error?.message || String(error));
    if (error?.code) err.code = error.code;
    console.error("❌ Import by Container ID error:", err.message);
    return handlePhantomError(res, "Import by Container ID", err);
  }
}

// ============================================
// 3. ENRICH PROFILES (ONE-CLICK)
// ============================================
export async function enrichProfilesComplete(req, res) {
  try {
    const { profileUrls } = req.body;

    if (!profileUrls || !Array.isArray(profileUrls) || profileUrls.length === 0) {
      return res.status(400).json({
        success: false,
        error: "profileUrls array is required",
        example: {
          profileUrls: [
            "https://www.linkedin.com/in/example1/",
            "https://www.linkedin.com/in/example2/"
          ]
        }
      });
    }

    console.log("\n🎯 === PROFILE ENRICHMENT STARTED ===\n");

    // Step 1: Launch and wait
    const result = await phantomService.enrichProfiles(profileUrls);

    if (result.data.length === 0) {
      return res.json({
        success: true,
        message: "No profiles enriched",
        totalProfiles: 0
      });
    }

    // Step 2: Parse results
    const leads = parsePhantomResults(result.data);
    console.log(`✅ Parsed ${leads.length} enriched profiles`);

    // Step 3: Save to database (update existing or insert new)
    let savedCount = 0;
    for (const lead of leads) {
      try {
        const saved = await saveLead(lead);
        if (saved) savedCount++;
      } catch (err) {
        console.error("Error saving enriched lead:", err.message);
      }
    }

    // Step 4: Export to CSV
    const { filepath, filename } = exportLeadsToCSV(leads);

    console.log("\n✅ === ENRICHMENT COMPLETED ===");
    console.log(`   Total: ${leads.length}`);
    console.log(`   Saved: ${savedCount}`);
    console.log(`   CSV: ${filename}\n`);

    try {
      await NotificationService.create({
        type: 'lead_enriched',
        title: 'Profile enrichment completed',
        message: `Enriched ${savedCount} profiles from LinkedIn`,
        data: {
          totalProfiles: leads.length,
          saved: savedCount,
          csvFile: filename,
          link: '/leads?source=search_export',
        },
      });
    } catch (notifyErr) {
      console.error('NotificationService (enrichProfilesComplete) error:', notifyErr.message);
    }

    return res.json({
      success: true,
      message: "Profile enrichment completed",
      totalProfiles: leads.length,
      savedToDatabase: savedCount,
      csvFile: filename,
      csvPath: filepath
    });

  } catch (error) {
    return handlePhantomError(res, "Enrichment", error);
  }
}

// ============================================
// CRM SEARCH RUN (Automated: CRM criteria → LinkedIn URL → PhantomBuster → DB → CRM)
// ============================================
export async function crmSearchRun(req, res) {
  const log = (msg, data) => {
    console.log(`[CRM-Search] ${msg}`, data !== undefined ? data : "");
  };

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    let criteria = body.criteria && typeof body.criteria === "object" ? body.criteria : null;
    const limit = body.limit != null && body.limit !== "" && Number.isFinite(Number(body.limit)) && Number(body.limit) > 0
      ? Number(body.limit)
      : null;

    log("Step 1: Resolving search criteria");
    if (!criteria && isCrmConfigured()) {
      try {
        criteria = await getSearchCriteriaFromCrm();
      } catch (crmErr) {
        log("CRM criteria fetch failed; cannot run without criteria", crmErr.message);
        return res.status(502).json({
          success: false,
          code: "CRM_CRITERIA_FAILED",
          message: "Failed to fetch search criteria from CRM. Provide criteria in request body or fix CRM configuration.",
          details: crmErr.message,
        });
      }
    }
    if (!criteria || (typeof criteria === "object" && !Object.values(criteria).some(Boolean))) {
      return res.status(400).json({
        success: false,
        code: "MISSING_CRITERIA",
        message: "No search criteria. Send body.criteria (title, location, industry, company) or configure CRM to provide criteria.",
        example: { criteria: { title: "CEO", location: "San Francisco", industry: "Technology" }, limit: 50 },
      });
    }

    log("Step 2: Building LinkedIn search URL from criteria", criteria);
    const linkedInUrl = buildLinkedInSearchUrl(criteria);
    const queryString = buildSearchQueryFromCriteria(criteria);
    log("LinkedIn URL generated", linkedInUrl);

    log("Step 3: Launching PhantomBuster LinkedIn Search Export");
    const result = await phantomService.searchLeads(linkedInUrl, limit);

    const data = Array.isArray(result?.data) ? result.data : [];
    if (data.length === 0) {
      log("No leads returned from PhantomBuster");
      return res.json({
        success: true,
        message: "CRM search run completed; no leads found",
        criteria,
        linkedInUrl,
        totalLeads: 0,
        savedToDatabase: 0,
        pushedToCrm: 0,
      });
    }

    log("Step 4: Parsing and saving leads to database", `count=${data.length}`);
    const leads = parsePhantomResults(data);
    const leadSource = "search_export";
    let savedCount = 0;
    for (const lead of leads) {
      try {
        const saved = await saveLead({ ...lead, source: leadSource });
        if (saved) savedCount++;
      } catch (err) {
        console.error("[CRM-Search] Error saving lead:", err.message);
      }
    }

    const { filepath, filename } = exportLeadsToCSV(leads);

    try {
      await pool.query(
        `INSERT INTO import_logs (source, container_id, total_leads, saved, duplicates, csv_file, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          leadSource,
          result.containerId || null,
          leads.length,
          savedCount,
          leads.length - savedCount,
          filename || null,
        ]
      );
    } catch (err) {
      console.error("[CRM-Search] Failed to log import:", err.message);
    }

    log("Step 5: Pushing leads to CRM (if configured)");
    const crmResult = await pushLeadsToCrm(leads);
    const pushedToCrm = crmResult.pushed ?? 0;
    if (crmResult.error) {
      log("CRM push had error (leads still saved to DB)", crmResult.error);
    }

    log("CRM search run completed", { totalLeads: leads.length, savedToDatabase: savedCount, pushedToCrm });

    try {
      await NotificationService.create({
        type: 'phantom_completed',
        title: 'CRM search completed',
        message: `Imported ${savedCount} leads from CRM search`,
        data: {
          criteria,
          linkedInUrl,
          query: queryString,
          totalLeads: leads.length,
          saved: savedCount,
          duplicates: leads.length - savedCount,
          pushedToCrm,
          csvFile: filename,
          link: '/leads?source=search_export',
        },
      });
    } catch (notifyErr) {
      console.error('NotificationService (crmSearchRun) error:', notifyErr.message);
    }

    return res.json({
      success: true,
      message: "CRM search run completed",
      criteria,
      linkedInUrl,
      query: queryString,
      totalLeads: leads.length,
      savedToDatabase: savedCount,
      duplicates: leads.length - savedCount,
      pushedToCrm,
      csvFile: filename,
      csvPath: filepath,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(error?.message ?? String(error));
    if (error?.code) err.code = error.code;
    if (error?.details) err.details = error.details;
    console.error("[CRM-Search] Error:", err.message);
    console.error(err.stack);
    return handlePhantomError(res, "CRM Search Run", err);
  }
}

// ============================================
// 4. SEND LINKEDIN MESSAGE (LinkedIn Message Sender phantom)
// ============================================
export async function sendMessageComplete(req, res) {
  try {
    const { leadId, linkedinUrl, message } = req.body;

    const profileUrl = linkedinUrl;
    const messageContent = message;

    if (!profileUrl || !messageContent || typeof messageContent !== "string" || messageContent.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "linkedinUrl and message are required",
        example: { leadId: 1, linkedinUrl: "https://www.linkedin.com/in/john-doe/", message: "Hi John, I'd like to connect." }
      });
    }

    const profile = { linkedin_url: profileUrl };
    if (leadId) {
      const leadRes = await pool.query("SELECT * FROM leads WHERE id = $1", [leadId]);
      if (leadRes.rows.length > 0) {
        Object.assign(profile, leadRes.rows[0]);
      }
    }

    console.log("\n🎯 === LINKEDIN MESSAGE SEND STARTED ===\n");
    // PhantomBuster dashboard has "First Name" – we pass our AI message via a fetchable CSV URL
    const token = createToken(profileUrl, messageContent.trim());
    const baseUrl = process.env.BACKEND_PUBLIC_URL || (req.protocol && req.get ? `${req.protocol}://${req.get("host")}` : null);
    const spreadsheetUrl = baseUrl ? `${baseUrl.replace(/\/$/, "")}/api/phantom/message-csv/${token}` : null;
    if (!spreadsheetUrl) {
      console.warn("   ⚠️ BACKEND_PUBLIC_URL not set – PhantomBuster may not fetch AI message. Set it in .env (e.g. https://your-api.com) for local dev use ngrok.");
    }
    const result = await phantomService.sendMessage(profile, messageContent.trim(), { spreadsheetUrl });

    // Message Sender scrapes basic profile – save to lead_enrichment for personalization
    if (leadId && result.resultData && result.resultData.length > 0) {
      try {
        const { default: enrichmentService } = await import("../services/enrichment.service.js");
        const normalizedUrl = (profileUrl || "").toLowerCase().replace(/\/$/, "");
        const matched = result.resultData.find((row) => {
          const url = (row.profileUrl || row.linkedinUrl || row.linkedInUrl || row.url || "").toLowerCase();
          return url && (url.includes(normalizedUrl) || normalizedUrl.includes(url.replace(/\/$/, "")));
        }) || result.resultData[0];
        const enrichmentData = enrichmentService.parseProfileData(matched);
        if (enrichmentData.bio || (enrichmentData.interests && enrichmentData.interests.length > 0)) {
          const recentPostsJson = JSON.stringify(enrichmentData.recent_posts || []);
          const companyNewsJson = enrichmentData.company_news != null ? JSON.stringify(enrichmentData.company_news) : null;
          await pool.query(
            `INSERT INTO lead_enrichment (lead_id, bio, interests, recent_posts, company_news)
             VALUES ($1, $2, $3::text[], $4::jsonb, $5::jsonb)
             ON CONFLICT (lead_id) DO UPDATE SET
               bio = COALESCE($2, lead_enrichment.bio),
               interests = COALESCE($3::text[], lead_enrichment.interests),
               recent_posts = COALESCE($4::jsonb, lead_enrichment.recent_posts),
               company_news = COALESCE($5::jsonb, lead_enrichment.company_news),
               last_enriched_at = NOW()`,
            [leadId, enrichmentData.bio || "", enrichmentData.interests || [], recentPostsJson, companyNewsJson]
          );
          console.log(`   📋 Saved profile data from Message Sender to lead_enrichment for lead ${leadId}`);
        }
      } catch (saveErr) {
        console.warn(`   ⚠️ Could not save Message Sender profile data (non-fatal):`, saveErr.message);
      }
    }

    console.log("\n✅ === MESSAGE SENT ===");
    console.log(`   Container: ${result.containerId}\n`);

    try {
      await NotificationService.create({
        type: 'message_sent',
        title: 'Message sent',
        message: `LinkedIn message sent to ${profile.full_name || profile.linkedin_url || 'lead'}`,
        data: {
          leadId: leadId || null,
          containerId: result.containerId || null,
          profileUrl: profile.linkedin_url,
          link: leadId ? `/leads/${leadId}` : undefined,
        },
      });
    } catch (notifyErr) {
      console.error('NotificationService (sendMessageComplete) error:', notifyErr.message);
    }

    return res.json({
      success: true,
      message: "LinkedIn message sent successfully",
      containerId: result.containerId,
      profileUrl: profile.linkedin_url,
      enrichmentSaved: !!(leadId && result.resultData?.length > 0)
    });
  } catch (error) {
    return handlePhantomError(res, "Send Message", error);
  }
}

// ============================================
// LEGACY METHODS (Keep for backward compatibility)
// ============================================
export async function startConnectionExport(req, res) {
  try {
    const { phantomId, sessionCookie } = req.body;

    if (!phantomId || !sessionCookie) {
      return res.status(400).json({
        error: "phantomId and sessionCookie are required"
      });
    }

    const result = await phantomService.launchPhantom(phantomId);
    const agentId = result.containerId;

    if (!agentId) {
      return res.status(500).json({
        error: "Phantom launched but containerId not returned"
      });
    }

    return res.status(200).json({
      message: "Phantom job started successfully",
      agentId
    });

  } catch (error) {
    console.error("Error starting Phantom job:", error.response?.data || error.message);
    return res.status(500).json({
      error: "Failed to start Phantom job"
    });
  }
}

export async function importPhantomResults(req, res) {
  try {
    const { resultUrl } = req.body;

    if (!resultUrl) {
      return res.status(400).json({
        error: "resultUrl is required",
        example: "https://phantombuster.s3.amazonaws.com/.../result.json"
      });
    }

    console.log("📥 Fetching results from PhantomBuster...");
    console.log("🔗 URL:", resultUrl);

    const response = await fetch(resultUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.statusText}`);
    }

    const resultData = await response.json();
    console.log("✅ Results fetched successfully");

    const leads = parsePhantomResults(resultData);

    if (leads.length === 0) {
      return res.status(200).json({
        message: "No leads found in the result",
        totalLeads: 0
      });
    }

    console.log("💾 Saving to database...");
    let savedCount = 0;
    let errors = 0;

    for (const lead of leads) {
      try {
        const saved = await saveLead(lead);
        if (saved) savedCount++;
      } catch (err) {
        console.error("❌ Error saving lead:", err.message);
        errors++;
      }
    }

    const { filepath, filename } = exportLeadsToCSV(leads);

    console.log("\n🎉 Import completed!");
    console.log(`   Total leads: ${leads.length}`);
    console.log(`   Saved to DB: ${savedCount}`);
    console.log(`   CSV file: ${filename}\n`);

    return res.status(200).json({
      success: true,
      message: "Leads imported successfully",
      totalLeads: leads.length,
      savedToDatabase: savedCount,
      duplicates: leads.length - savedCount - errors,
      errors: errors,
      csvFile: filename,
      csvPath: filepath
    });

  } catch (error) {
    console.error("❌ Import error:", error.message);
    return res.status(500).json({
      error: "Failed to import results",
      details: error.message
    });
  }
}