-- Prospects = all leads that have ever been added to any campaign.
-- Adding this flag so removing a lead from a campaign does not remove them from Prospects.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ever_in_campaign BOOLEAN DEFAULT FALSE;

-- Backfill: mark all leads that currently have at least one campaign_leads row
UPDATE leads
SET ever_in_campaign = TRUE
WHERE id IN (SELECT DISTINCT lead_id FROM campaign_leads)
  AND (ever_in_campaign IS NULL OR ever_in_campaign = FALSE);

CREATE INDEX IF NOT EXISTS idx_leads_ever_in_campaign ON leads(ever_in_campaign) WHERE ever_in_campaign = TRUE;
