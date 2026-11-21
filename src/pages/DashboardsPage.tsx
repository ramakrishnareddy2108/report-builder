import { LayoutDashboard } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export function DashboardsPage() {
  return (
    <>
      <PageHeader
        title="Dashboards"
        description="Charts of revenue and profit across doctors, departments, sponsors and months."
      />
      <EmptyState
        icon={LayoutDashboard}
        title="Dashboards are coming later"
        description="Dashboards are planned for version 2 and will use the saved months."
      />
    </>
  );
}
