import { FileSpreadsheet } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export function SourcesPage() {
  return (
    <>
      <PageHeader
        title="Sources"
        description="How each of the 8 HIS Excel exports is read: sheet, header row and column mapping."
      />
      <EmptyState
        icon={FileSpreadsheet}
        title="No sources set up yet"
        description="Source mappings will appear here once a workspace is set up."
      />
    </>
  );
}
