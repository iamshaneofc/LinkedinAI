import LeadsTable from '../components/LeadsTable';

/**
 * Leads = all leads in one place. Replaces the separate Imported Leads and Review Leads pages.
 * Shows full list with review tabs (All, Approved, To Review, Rejected, Imported).
 */
export default function LeadsPage() {
  return (
    <LeadsTable
      baseQuery={{}}
      showReviewTabs={true}
      reviewTabs={['all', 'approved', 'to_be_reviewed', 'rejected', 'imported']}
      initialReviewTab="all"
      showBackToReview={false}
      listTitle="Leads"
      applyDefaultDateRange={false}
    />
  );
}
