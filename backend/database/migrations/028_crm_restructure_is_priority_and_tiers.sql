-- Migration 028: CRM Restructure - is_priority, indexes, tiered preferences
-- Part of LeadForge CRM restructuring: My Contacts (is_priority), performance indexes,
-- and preference_settings tiered structure.

-- 1. Add is_priority to leads (AI high-priority leads for My Contacts)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS is_priority BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN leads.is_priority IS 'True when lead is AI high-priority (Primary tier or Secondary with score >= threshold); drives My Contacts list';

-- 2. Performance indexes (create if not exist)
CREATE INDEX IF NOT EXISTS idx_leads_is_priority ON leads(is_priority) WHERE is_priority = TRUE;
CREATE INDEX IF NOT EXISTS idx_leads_preference_tier ON leads(preference_tier);
CREATE INDEX IF NOT EXISTS idx_leads_review_status ON leads(review_status);
CREATE INDEX IF NOT EXISTS idx_leads_connection_degree ON leads(connection_degree);

-- 3. Tiered preference structure in preference_settings
-- Store as JSONB: { "primary": { "titles": [], "industries": [], "company_sizes": [] }, "secondary": {...}, "tertiary": {...} }
ALTER TABLE preference_settings
  ADD COLUMN IF NOT EXISTS preference_tiers JSONB DEFAULT '{"primary":{"titles":[],"industries":[],"company_sizes":[]},"secondary":{"titles":[],"industries":[],"company_sizes":[]},"tertiary":{"titles":[],"industries":[],"company_sizes":[]}}';

-- Configurable threshold for Secondary tier -> is_priority (default 70)
ALTER TABLE preference_settings
  ADD COLUMN IF NOT EXISTS secondary_priority_threshold INTEGER DEFAULT 70;

COMMENT ON COLUMN preference_settings.preference_tiers IS 'Tiered preferences: primary/secondary/tertiary each with titles, industries, company_sizes arrays (max 5 per dropdown, no duplicates across tiers)';
COMMENT ON COLUMN preference_settings.secondary_priority_threshold IS 'Min preference_score for Secondary tier to set is_priority=true (default 70)';
