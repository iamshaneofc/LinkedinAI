import LeadsTable from '../components/LeadsTable';

/**
 * Prospects = 2nd & 3rd degree workflow.
 * Base query: connection_degree IN ('2nd','3rd'). Tabs: Review (default), Qualified, Rejected.
 */
export default function ProspectsPage() {
  return (
    <LeadsTable
      baseQuery={{ connection_degree: '2nd,3rd' }}
      showReviewTabs={true}
      showBackToReview={false}
    />
  );
}
