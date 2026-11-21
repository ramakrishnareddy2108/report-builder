import { FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/app/store';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { pickWorkspaceFolder } from '@/storage/workspace';

export function WorkspacePage() {
  const workspace = useAppStore((s) => s.workspace);
  const setWorkspace = useAppStore((s) => s.setWorkspace);

  async function choose() {
    try {
      const handle = await pickWorkspaceFolder();
      if (handle) setWorkspace(handle);
    } catch {
      toast.error('Could not open that folder. Please try again or choose a different folder.');
    }
  }

  return (
    <>
      <PageHeader
        title="Workspace"
        description="The folder on this laptop where settings, monthly runs and reports are saved."
      />
      {workspace ? (
        <EmptyState
          icon={FolderOpen}
          title={`Using “${workspace.name}”`}
          description="Workspace setup and folder checks will appear here."
          action={
            <Button variant="outline" onClick={choose}>
              Choose a different folder
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={FolderOpen}
          title="No workspace selected"
          description="Choose a folder to keep this app's settings, monthly data and generated reports."
          action={<Button onClick={choose}>Choose workspace folder</Button>}
        />
      )}
    </>
  );
}
