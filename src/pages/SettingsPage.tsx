import { FolderOpen } from 'lucide-react';
import { useWorkspace } from '@/app/useWorkspace';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { TemplatesCard } from '@/components/settings/TemplatesCard';

export function SettingsPage() {
  const ws = useWorkspace();
  return (
    <>
      <PageHeader title="Settings" description="Report templates and, below them, the measure rules." />
      {ws ? (
        <div className="space-y-6">
          <TemplatesCard ws={ws} />
        </div>
      ) : (
        <EmptyState
          icon={FolderOpen}
          title="Choose a workspace folder first"
          description="Settings are saved in the workspace folder. Open the Workspace page to choose it."
        />
      )}
    </>
  );
}
