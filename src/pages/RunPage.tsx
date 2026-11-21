import { FolderOpen, Loader2, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { chooseMonth, refreshMonth, startRun, useRun } from '@/app/runSession';
import { useSourceInfos } from '@/app/useSourceInfos';
import { useWorkspace } from '@/app/useWorkspace';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { FileDropZone } from '@/components/files/FileDropZone';
import { LoadedFilesList } from '@/components/files/LoadedFilesList';
import { MonthPicker } from '@/components/MonthPicker';
import { PageHeader } from '@/components/PageHeader';
import { AttributionSummary } from '@/components/run/AttributionSummary';
import { ChecksPanel } from '@/components/run/ChecksPanel';
import { ReportGrid } from '@/components/run/ReportGrid';
import { RunActions } from '@/components/run/RunActions';
import { RunStatusPanel, allSourcesReady } from '@/components/run/RunStatusPanel';
import { SavedRunsList } from '@/components/run/SavedRunsList';
import { SettingsGate } from '@/components/SettingsGate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { countByLevel } from '@/core/checks';
import { doctorReport, sponsorReport } from '@/core/report';
import type { Workspace } from '@/storage/workspace';

export function RunPage() {
  const ws = useWorkspace();
  const header = (
    <PageHeader
      title="Run"
      description="Turn this month’s files into the Doctor-wise and Sponsor-wise reports, check them, and save the run."
    />
  );
  if (!ws) {
    return (
      <>
        {header}
        <EmptyState
          icon={FolderOpen}
          title="Choose a workspace folder first"
          description="Runs are saved in the workspace folder. Open the Workspace page to choose it."
        />
      </>
    );
  }
  return (
    <>
      {header}
      <SettingsGate>
        <RunWorkspace ws={ws} />
      </SettingsGate>
    </>
  );
}

function RunWorkspace({ ws }: { ws: Workspace }) {
  const month = useRun((s) => s.month);
  const status = useRun((s) => s.status);
  const progress = useRun((s) => s.progress);
  const error = useRun((s) => s.error);
  const infos = useSourceInfos();
  const [pendingMonth, setPendingMonth] = useState<string | null>(null);
  const unsaved = useRun((s) => s.result !== null && s.result.saved === null);

  useEffect(() => {
    void refreshMonth(ws, month);
  }, [ws, month]);

  const running = status === 'running';
  const ready = allSourcesReady(infos);
  const anyFile = Object.values(infos).some((i) => i.file !== null);

  function changeMonth(next: string) {
    if (next === month) return;
    if (unsaved) setPendingMonth(next);
    else chooseMonth(ws, next);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>1. This month’s files</CardTitle>
          <CardDescription>Drop the exports here, or load them on the Sources page. Nothing is uploaded.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FileDropZone />
          <LoadedFilesList />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Run</CardTitle>
          <CardDescription>Every source must be Ready. A source that is Flagged or Missing is reported as a failed check.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <MonthPicker value={month} onChange={changeMonth} />
          <RunStatusPanel />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void startRun(ws)} disabled={running || !anyFile}>
              {running ? <Loader2 className="animate-spin" /> : <Play />}
              {running ? 'Running…' : `Run ${month}`}
            </Button>
            {!anyFile && <p className="text-sm text-muted-foreground">Load at least one file to run.</p>}
            {anyFile && !ready && !running && (
              <p className="text-sm text-amber-700">Some sources are not Ready. You can still run to see what the checks say.</p>
            )}
          </div>
          {running && (
            <div className="space-y-1" aria-live="polite">
              <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round((progress?.fraction ?? 0) * 100)} aria-label="Run progress">
                <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${Math.round((progress?.fraction ?? 0) * 100)}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {progress?.stage}
                {progress?.detail ? ` — ${progress.detail}` : ''}
              </p>
            </div>
          )}
          {error && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      <Results ws={ws} />

      <Card>
        <CardHeader>
          <CardTitle>Saved runs for {month}</CardTitle>
          <CardDescription>A Final run is read-only. Running a Final month again saves a new run.</CardDescription>
        </CardHeader>
        <CardContent>
          <SavedRunsList ws={ws} />
        </CardContent>
      </Card>

      <ConfirmDialog
        open={pendingMonth !== null}
        title="Discard this run?"
        description="The run on screen has not been saved. Choosing another month discards it."
        confirmLabel="Discard and switch"
        destructive
        onCancel={() => setPendingMonth(null)}
        onConfirm={() => {
          if (pendingMonth) chooseMonth(ws, pendingMonth);
          setPendingMonth(null);
        }}
      />
    </div>
  );
}

function Results({ ws }: { ws: Workspace }) {
  const result = useRun((s) => s.result);
  const notes = useRun((s) => s.notes);

  const drr = useMemo(() => (result ? doctorReport(result.facts, result.costs, result.settings.doctors.doctors, result.month) : []), [result]);
  const sponsors = useMemo(() => (result ? sponsorReport(result.facts, result.month) : []), [result]);
  const checks = useMemo(() => (result ? result.checks.map((c) => (notes[c.id] ? { ...c, note: notes[c.id] } : c)) : []), [result, notes]);
  const counts = countByLevel(checks);

  if (!result) return null;
  const final = result.saved?.status === 'Final';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Results for {result.month}
          {result.saved ? <Badge variant={final ? 'default' : 'secondary'}>Run {result.saved.runNumber} · {result.saved.status}</Badge> : <Badge variant="outline">Not saved yet</Badge>}
        </CardTitle>
        <CardDescription>
          {result.facts.length.toLocaleString('en-IN')} fact rows from {result.fingerprints.length} files.
          {counts.Fail > 0 && ` ${counts.Fail} failed check${counts.Fail === 1 ? '' : 's'}.`}
          {counts.Warning > 0 && ` ${counts.Warning} warning${counts.Warning === 1 ? '' : 's'}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RunActions ws={ws} />
        <Tabs defaultValue="doctors">
          <TabsList>
            <TabsTrigger value="doctors">Doctor-wise</TabsTrigger>
            <TabsTrigger value="sponsors">Sponsor-wise</TabsTrigger>
            <TabsTrigger value="checks">
              Checks
              {counts.Fail > 0 && <Badge variant="destructive">{counts.Fail}</Badge>}
              {counts.Warning > 0 && <Badge variant="outline">{counts.Warning}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="pharmacy">Pharmacy attribution</TabsTrigger>
          </TabsList>
          <TabsContent value="doctors" className="mt-4">
            <ReportGrid kind="drr" rows={drr} />
          </TabsContent>
          <TabsContent value="sponsors" className="mt-4">
            <ReportGrid kind="sponsor" rows={sponsors} />
          </TabsContent>
          <TabsContent value="checks" className="mt-4">
            <ChecksPanel checks={checks} notes={notes} readOnly={final} />
          </TabsContent>
          <TabsContent value="pharmacy" className="mt-4">
            <AttributionSummary facts={result.facts} checks={checks} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
