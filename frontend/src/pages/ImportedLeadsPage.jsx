import LeadsTable from '../components/LeadsTable';

/**
 * Imported Leads = only leads from CSV/Excel import (source csv_import or excel_import).
 * Same table UX as My Contacts but dedicated page; not a filter of My Contacts.
 */
export default function ImportedLeadsPage() {
  return (
    <LeadsTable
      baseQuery={{ source: 'csv_import,excel_import' }}
      showReviewTabs={false}
      showBackToReview={false}
      showImportedStats={true}
      listTitle="Imported Leads"
      applyDefaultDateRange={false}
    />
  );
}
