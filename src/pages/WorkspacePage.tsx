import { AlertTriangle, Archive, FolderOpen, RotateCcw, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useSettings } from '@/app/settingsStore';
import { useAppStore } from '@/app/store';
import { useWorkspace } from '@/app/useWorkspace';
import { chooseWorkspace, reconnectWorkspace } from '@/app/workspaceSession';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { applyRestore, createBackup, downloadFile, planRestore, type RestorePlan } from '@/storage/backup';
import type { Workspace, WorkspaceSummary } from '@/storage/workspace';

function isPermissionError(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
}

async function choose() {
  try {
    await chooseWorkspace();
  } catch {
    toast.error('Could not open that folder. Please try again or choose a different folder.');
  }
}

export function WorkspacePage() {
  const connection = useAppStore((s) => s.connection);
  const ws = useWorkspace();

  return (
    <>
      <PageHeader
        title="Workspace"
        description="The folder on this laptop where settings, monthly runs and reports are saved."
      />
      {connection.status === 'loading' && <p className="text-sm text-muted-foreground">Loading…</p>}
      {connection.status === 'none' && (
        <EmptyState
          icon={FolderOpen}
          title="No workspace selected"
          description="Choose a folder to keep this app's settings, monthly data and generated reports."
          action={<Button onClick={choose}>Choose workspace folder</Button>}
        />
      )}
      {connection.status === 'needs-permission' && (
        <EmptyState
          icon={FolderOpen}
          title={`Reconnect to “${connection.handle.name}”`}
          description="The browser needs your permission again to read and save files in this folder."
          action={
            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  try {
                    if (!(await reconnectWorkspace(connection.handle))) {
                      toast.error('Access was not allowed. Click “Reconnect folder” and choose “Allow”.');
                    }
                  } catch {
                    toast.error('Could not reconnect. The folder may have been moved or deleted.');
                  }
                }}
              >
                Reconnect folder
              </Button>
              <Button variant="outline" onClick={choose}>
                Choose a different folder
              </Button>
            </div>
          }
        />
      )}
      {connection.status === 'ready' && ws && <ConnectedWorkspace ws={ws} handle={connection.handle} />}
    </>
  );
}

function ConnectedWorkspace({ ws, handle }: { ws: Workspace; handle: FileSystemDirectoryHandle }) {
  const setConnection = useAppStore((s) => s.setConnection);
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleError = useCallback(
    (err: unknown, what: string) => {
      if (isPermissionError(err)) {
        setConnection({ status: 'needs-permission', handle });
        return;
      }
      const detail = err instanceof Error ? err.message : String(err);
      setError(`${what}: ${detail}`);
    },
    [handle, setConnection],
  );

  const refresh = useCallback(async () => {
    try {
      setSummary(await ws.summary());
      setError(null);
    } catch (err) {
      handleError(err, 'Could not read the workspace folder');
    }
  }, [ws, handleError]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const created = await ws.ensureLayout();
        if (cancelled) return;
        if (created.length > 0) toast.success(`Set up the workspace: created ${created.join(', ')}`);
        await refresh();
      } catch (err) {
        if (!cancelled) handleError(err, 'Could not set up the workspace folder');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ws, refresh, handleError]);

  async function backup() {
    setBusy('backup');
    try {
      const result = await createBackup(ws);
      downloadFile(result.data, result.fileName);
      toast.success(`Backup downloaded: ${result.fileName} (${result.fileCount} files)`);
    } catch (err) {
      handleError(err, 'Backup failed');
    } finally {
      setBusy(null);
    }
  }

  async function pickedZip(file: File) {
    setBusy('restore');
    try {
      setPlan(await planRestore(ws, file));
    } catch (err) {
      handleError(err, 'Could not read the backup');
    } finally {
      setBusy(null);
    }
  }

  async function confirmRestore() {
    if (!plan?.ok) return;
    setBusy('restore');
    try {
      const n = await applyRestore(ws, plan);
      toast.success(n === 0 ? 'Nothing to restore — the workspace already matches the backup.' : `Restored ${n} files.`);
      setPlan(null);
      await refresh();
      await useSettings.getState().load(ws); // pages must see the restored settings
    } catch (err) {
      setPlan(null);
      handleError(err, 'Restore stopped part-way. Some files may already be replaced');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="size-4 text-muted-foreground" />
            {ws.name}
          </CardTitle>
          <CardDescription>
            Settings and monthly data are saved here. Back up regularly — the backup holds settings and data, not the
            generated reports (those can be made again).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={backup} disabled={busy !== null}>
            <Archive />
            {busy === 'backup' ? 'Backing up…' : 'Back up'}
          </Button>
          <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
            <Upload />
            {busy === 'restore' ? 'Reading backup…' : 'Restore from backup'}
          </Button>
          <Button variant="ghost" onClick={choose} disabled={busy !== null}>
            <RotateCcw />
            Choose a different folder
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void pickedZip(file);
            }}
          />
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p className="whitespace-pre-wrap">{error}</p>
        </div>
      )}

      {summary && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Months</CardTitle>
              <CardDescription>Months that have at least one saved run.</CardDescription>
            </CardHeader>
            <CardContent>
              {summary.months.length === 0 ? (
                <p className="text-sm text-muted-foreground">No months yet. They appear here after you run a month.</p>
              ) : (
                <ul className="divide-y">
                  {summary.months.map((m) => (
                    <li key={m.month} className="flex items-center justify-between py-2">
                      <span className="font-medium">{m.month}</span>
                      <span className="flex flex-wrap justify-end gap-1">
                        {m.runs.length === 0 && <span className="text-muted-foreground">No runs</span>}
                        {m.runs.map((r) => (
                          <Badge key={r.runNumber} variant={r.status === 'Final' ? 'default' : 'secondary'}>
                            Run {r.runNumber} · {r.status}
                          </Badge>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Settings files</CardTitle>
              <CardDescription>Files in the settings folder.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {summary.settings.map((f) => (
                  <li key={f.path} className="py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">{f.label}</div>
                        <div className="truncate text-xs text-muted-foreground">{f.path}</div>
                      </div>
                      {f.status === 'ok' && <Badge variant="secondary">Present</Badge>}
                      {f.status === 'missing' && <Badge variant="outline">Missing</Badge>}
                      {f.status === 'invalid' && <Badge variant="destructive">Has problems</Badge>}
                    </div>
                    {f.message && (
                      <p className="mt-1 whitespace-pre-wrap text-xs text-destructive">{f.message}</p>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      <RestoreDialog
        plan={plan}
        busy={busy === 'restore'}
        onCancel={() => setPlan(null)}
        onConfirm={confirmRestore}
      />
    </div>
  );
}

function RestoreDialog({
  plan,
  busy,
  onCancel,
  onConfirm,
}: {
  plan: RestorePlan | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const replaced = plan?.ok ? plan.items.filter((i) => i.action === 'replace') : [];
  const finalTouched = replaced.some((i) => i.touchesFinalRun);

  return (
    <Dialog open={plan !== null} onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        {plan && !plan.ok && (
          <>
            <DialogHeader>
              <DialogTitle>This backup cannot be restored</DialogTitle>
              <DialogDescription>Nothing was changed. Problems found:</DialogDescription>
            </DialogHeader>
            <ul className="max-h-64 list-disc space-y-1 overflow-auto pl-5 text-sm whitespace-pre-wrap">
              {plan.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
            <DialogFooter>
              <Button variant="outline" onClick={onCancel}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
        {plan?.ok && (
          <>
            <DialogHeader>
              <DialogTitle>Restore this backup?</DialogTitle>
              <DialogDescription>
                Backup of “{plan.workspaceName}” made {new Date(plan.createdAt).toLocaleString()}.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <ul className="space-y-1">
                <li>
                  <strong>{plan.counts.replace}</strong> files will be replaced
                </li>
                <li>
                  <strong>{plan.counts.add}</strong> new files will be added
                </li>
                <li>
                  <strong>{plan.counts.unchanged}</strong> files are already the same
                </li>
                <li>Months in backup: {plan.months.length > 0 ? plan.months.join(', ') : 'none'}</li>
              </ul>
              {replaced.length > 0 && (
                <div>
                  <div className="mb-1 font-medium">Will be replaced:</div>
                  <ul className="max-h-48 overflow-auto rounded border p-2 font-mono text-xs">
                    {replaced.map((i) => (
                      <li key={i.path} className={i.touchesFinalRun ? 'text-destructive' : undefined}>
                        {i.path}
                        {i.touchesFinalRun && ' (Final run)'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {finalTouched && (
                <p className="flex gap-2 text-destructive">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  Some replaced files belong to a Final run in this workspace.
                </p>
              )}
              <p className="text-muted-foreground">
                Files in the workspace that are not in the backup are kept. Generated reports in output/ are not
                touched.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
              <Button
                onClick={onConfirm}
                disabled={busy || plan.counts.add + plan.counts.replace === 0}
                variant={finalTouched ? 'destructive' : 'default'}
              >
                {busy ? 'Restoring…' : 'Restore'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
