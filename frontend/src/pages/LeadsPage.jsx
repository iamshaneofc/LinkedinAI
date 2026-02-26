import LeadsTable from '../components/LeadsTable';

/**
 * Leads = all leads (same combined view as before).
 * No base filter; shows Review/Qualified/Rejected tabs.
 */
export default function LeadsPage() {
  return (
    <LeadsTable
      baseQuery={{}}
      showReviewTabs={true}
      showBackToReview={false}
      applyDefaultDateRange={false}
    />
  );
}
