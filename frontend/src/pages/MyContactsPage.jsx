import LeadsTable from '../components/LeadsTable';

/**
 * My Contacts = AI high-priority leads (is_priority = true).
 * Single list, no Review/Qualified/Rejected tabs. Search, filters, Add to Campaign, Enrich & Personalize, Back to Review.
 */
export default function MyContactsPage() {
  return (
    <LeadsTable
      baseQuery={{ is_priority: true }}
      showReviewTabs={false}
      showBackToReview={true}
    />
  );
}
