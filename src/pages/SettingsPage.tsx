import { Settings } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Measure rules, report templates, default costs and backups."
      />
      <EmptyState
        icon={Settings}
        title="No settings yet"
        description="Settings will be available once a workspace is selected."
      />
    </>
  );
}
