import { Play } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export function RunPage() {
  return (
    <>
      <PageHeader
        title="Run"
        description="Load a month's files, review the checks and generate the DRR and Sponsor-wise reports."
      />
      <EmptyState
        icon={Play}
        title="No run started"
        description="Start a monthly run here once sources and doctors are set up."
      />
    </>
  );
}
