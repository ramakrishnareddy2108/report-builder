import { LayoutDashboard } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export function DashboardsPage() {
  return (
    <>
      <PageHeader title="Dashboards" description="Charts and totals from your finished reports." />
      <EmptyState
        icon={LayoutDashboard}
        title="No dashboards yet"
        description="Generate a report, or upload saved report files, to see charts here."
      />
    </>
  );
}
