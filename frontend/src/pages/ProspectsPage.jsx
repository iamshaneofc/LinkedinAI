import LeadsTable from '../components/LeadsTable';

/**
 * Prospects = leads that are in a campaign (pending to campaign or already in a campaign).
 * Shows any lead that has at least one campaign_leads row (any status). Response logic can be added later.
 * Single tab only; no review or reject. Leads appear here when added to any campaign (response logic can be added later).
 */
export default function ProspectsPage() {
  return (
    <LeadsTable
      baseQuery={{ prospects: true }}
      showReviewTabs={false}
      showBackToReview={false}
      listTitle="Prospects"
      applyDefaultDateRange={false}
    />
  );
}
