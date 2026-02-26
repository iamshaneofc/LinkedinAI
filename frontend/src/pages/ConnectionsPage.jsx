import LeadsTable from '../components/LeadsTable';

/**
 * Connections = 1st degree workflow.
 * Base query: connection_degree = '1st'. Tabs: Review (default), Qualified, Rejected.
 */
export default function ConnectionsPage() {
  return (
    <LeadsTable
      baseQuery={{ connection_degree: '1st' }}
      showReviewTabs={true}
      showBackToReview={false}
    />
  );
}
