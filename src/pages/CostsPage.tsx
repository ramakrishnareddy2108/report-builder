import { Wallet } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export function CostsPage() {
  return (
    <>
      <PageHeader
        title="Costs"
        description="Departmental issues, salary, incentives and professional fee entered per doctor."
      />
      <EmptyState
        icon={Wallet}
        title="No costs entered"
        description="Per-doctor costs for the month will be entered here."
      />
    </>
  );
}
