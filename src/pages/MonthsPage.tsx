import { CalendarRange } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export function MonthsPage() {
  return (
    <>
      <PageHeader
        title="Months"
        description="Every saved monthly run, Draft or Final, for comparison."
      />
      <EmptyState
        icon={CalendarRange}
        title="No months saved"
        description="Completed runs will be listed here by month."
      />
    </>
  );
}
