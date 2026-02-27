import express from "express";
import {
    getLeads,
    getLeadById,
    searchLeads,
    updateLead,
    deleteLead,
    getStats,
    getImports,
    importLeads,
    importLeadsFromCSV,
    importLeadsFromExcel,
    deleteCSVLeads,
    deleteAllLeads,
    deleteAllImportedLeads,
    bulkDeleteLeads,
    enrichLead,
    enrichLeadsBatch,
    hunterEmailBatch,
    getLeadEnrichment,
    getEnrichedLeads,
    bulkEnrichAndPersonalize,
    generatePersonalizedMessage,
    generateGmail,
    addGmailToApprovals,
    // PHASE 4: Review & Approval
    bulkApproveLeads,
    bulkRejectLeads,
    moveToReview,
    getReviewStats,
    qualifyLeadsByNiche,
    backToReview,
    createLead,
    exportLeads
} from "../controllers/lead.controller.js";
import { upload } from "../middleware/upload.js";

const router = express.Router();

// PHASE 4: Lead Review & Approval Routes (Must be before /:id)
router.get("/review-stats", getReviewStats);
router.post("/bulk-approve", bulkApproveLeads);
router.post("/bulk-reject", bulkRejectLeads);
router.post("/move-to-review", moveToReview);
router.post("/back-to-review", backToReview);
router.post("/qualify-by-niche", qualifyLeadsByNiche);

router.get("/", getLeads);
router.post("/", createLead);
router.get("/search", searchLeads);
router.get("/stats", getStats);
router.get("/imports", getImports);
router.get("/export", exportLeads);
router.get("/enriched", getEnrichedLeads);
router.get("/:id", getLeadById);
router.get("/:id/enrichment", getLeadEnrichment);
router.put("/:id", updateLead);
// Destructive routes - order matters (specific before param routes)
router.delete("/csv-imports/all", deleteCSVLeads);
router.delete("/imported/all", deleteAllImportedLeads);
router.post("/bulk-delete", bulkDeleteLeads);
router.delete("/all", deleteAllLeads);
router.delete("/:id", deleteLead);
router.post("/import", importLeads);
router.post("/import-csv", upload.single('csvFile'), importLeadsFromCSV);
router.post("/import-excel", upload.single('excelFile'), importLeadsFromExcel);
router.post("/enrich-batch", enrichLeadsBatch);
router.post("/hunter-email-batch", hunterEmailBatch);
router.post("/bulk-enrich-personalize", bulkEnrichAndPersonalize);
router.post("/:id/enrich", enrichLead);
router.post("/:id/generate-message", generatePersonalizedMessage);
router.post("/:id/generate-gmail", generateGmail);
router.post("/:id/add-gmail-to-approvals", addGmailToApprovals);

// End of routes

export default router;
