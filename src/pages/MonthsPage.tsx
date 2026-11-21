import { FileUp, FolderOpen, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useMonthOverviews } from '@/app/monthActions';
import { useWorkspace } from '@/app/useWorkspace';
import { EmptyState } from '@/components/EmptyState';
import { CompareView } from '@/components/months/CompareView';
import { ImportDrrDialog } from '@/components/months/ImportDrrDialog';
import { MonthsTable } from '@/components/months/MonthsTable';
import { TrendView } from '@/components/months/TrendView';
import { PageHeader } from '@/components/PageHeader';
import { SettingsGate } from '@/components/SettingsGate';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Workspace } from '@/storage/workspace';

export function MonthsPage() {
  const ws = useWorkspace();
  const header = (
    <PageHeader
      title="Months"
      description="Every saved month: totals, checks, comparison between two months, and trends over time."
    />
  );
  if (!ws) {
    return (
      <>
        {header}
        <EmptyState
          icon={FolderOpen}
          title="Choose a workspace folder first"
          description="Saved months live in the workspace folder. Open the Workspace page to choose it."
        />
      </>
    );
  }
  return (
    <>
      {header}
      <SettingsGate>
        <MonthsWorkspace ws={ws} />
      </SettingsGate>
    </>
  );
}

function MonthsWorkspace({ ws }: { ws: Workspace }) {
  const { overviews, error, reload } = useMonthOverviews(ws);
  const [importFile, setImportFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  if (error) {
    return (
      <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
        Could not read the saved months: {error}
      </p>
    );
  }
  if (!overviews) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Reading the saved months…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Tabs defaultValue="months">
        <div className="flex flex-wrap items-center gap-3">
          <TabsList>
            <TabsTrigger value="months">Months</TabsTrigger>
            <TabsTrigger value="compare">Compare</TabsTrigger>
            <TabsTrigger value="trend">Trend</TabsTrigger>
          </TabsList>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => fileInput.current?.click()}>
            <FileUp />
            Import a past DRR
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx"
            className="hidden"
            aria-label="Choose a past DRR Excel file"
            onChange={(e) => {
              setImportFile(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
        </div>

        <TabsContent value="months" className="mt-4">
          {overviews.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="No month saved yet"
              description="Run a month on the Run page and save it, or import a past DRR to start the history."
            />
          ) : (
            <MonthsTable ws={ws} overviews={overviews} />
          )}
        </TabsContent>
        <TabsContent value="compare" className="mt-4">
          <CompareView overviews={overviews} />
        </TabsContent>
        <TabsContent value="trend" className="mt-4">
          <TrendView overviews={overviews} />
        </TabsContent>
      </Tabs>

      <ImportDrrDialog
        ws={ws}
        file={importFile}
        takenMonths={overviews.filter((o) => o.runs.length > 0).map((o) => o.month)}
        onClose={() => setImportFile(null)}
        onImported={() => void reload()}
      />
    </div>
  );
}
