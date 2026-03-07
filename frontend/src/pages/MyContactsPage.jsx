import LeadsTable from '../components/LeadsTable';

/**
 * My Contacts = only highly prioritized leads matching your profile (Primary tier via industry / URL).
 * No duplicates (deduped by LinkedIn URL then email). Single list; Back to Review available.
 */
export default function MyContactsPage() {
  return (
    <LeadsTable
      baseQuery={{ my_contacts: true }}
      showReviewTabs={false}
      showBackToReview={true}
      listTitle="My Contacts"
      applyDefaultDateRange={false}
    />
  );
}
