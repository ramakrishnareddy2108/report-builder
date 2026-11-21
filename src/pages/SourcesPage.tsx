import { FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { useSourceInfos } from '@/app/useSourceInfos';
import { useWorkspace } from '@/app/useWorkspace';
import { EmptyState } from '@/components/EmptyState';
import { FileDropZone } from '@/components/files/FileDropZone';
import { LoadedFilesList } from '@/components/files/LoadedFilesList';
import { PageHeader } from '@/components/PageHeader';
import { MappingEditor } from '@/components/sources/MappingEditor';
import { SourcesTable } from '@/components/sources/SourcesTable';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { SourceId } from '@/core/types';
import { SettingsGate } from '@/components/SettingsGate';

export function SourcesPage() {
  const ws = useWorkspace();
  const infos = useSourceInfos();
  const [editing, setEditing] = useState<SourceId | null>(null);

  const header = (
    <PageHeader
      title="Sources"
      description="How each of the 8 HIS Excel exports is read: sheet, header row and column mapping."
    />
  );

  if (!ws) {
    return (
      <>
        {header}
        <EmptyState
          icon={FolderOpen}
          title="Choose a workspace folder first"
          description="Source mappings are saved in the workspace folder. Open the Workspace page to choose it."
        />
      </>
    );
  }

  return (
    <>
      {header}
      <SettingsGate>
        {editing ? (
          <MappingEditor key={editing} info={infos[editing]} onClose={() => setEditing(null)} />
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Files</CardTitle>
                <CardDescription>
                  Drop this month’s exports. Each file is recognised by its name and columns, and checked against its
                  saved mapping.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FileDropZone />
                <LoadedFilesList />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Sources</CardTitle>
                <CardDescription>
                  Ready: the saved mapping fits. Flagged: a column the mapping needs is missing, so nothing runs until
                  you fix it. Not mapped: confirm the suggested mapping once.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SourcesTable infos={infos} onEdit={setEditing} />
              </CardContent>
            </Card>
          </div>
        )}
      </SettingsGate>
    </>
  );
}
