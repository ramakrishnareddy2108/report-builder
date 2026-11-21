import { FileDown, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { downloadReports, useRun } from '@/app/runSession';
import { Button } from '@/components/ui/button';
import type { Workspace } from '@/storage/workspace';
import type { BuildReportsResult } from '@/worker/tasks/reports';

/** Make the DRR and Sponsor-wise workbooks from the saved run, keep a copy in output/, and download them. */
export function DownloadReports({ ws }: { ws: Workspace }) {
  const result = useRun((s) => s.result);
  const busy = useRun((s) => s.busy);
  const progress = useRun((s) => s.progress);
  const [last, setLast] = useState<BuildReportsResult | null>(null);
  if (!result) return null;

  async function make() {
    try {
      const built = await downloadReports(ws);
      setLast(built);
      if (built.files.length > 0) toast.success(`Made ${built.files.map((f) => f.fileName).join(' and ')}. A copy is in output/${result?.month}/.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  const making = busy === 'reports';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => void make()} disabled={!result.saved || busy !== null}>
          {making ? <Loader2 className="animate-spin" /> : <FileDown />}
          {making ? (progress?.stage ?? 'Making the reports…') : 'Download reports'}
        </Button>
        {!result.saved && <p className="text-sm text-muted-foreground">Save the run first. Reports are made from a saved run.</p>}
        {result.saved && result.saved.status === 'Draft' && (
          <p className="text-sm text-muted-foreground">This run is a Draft, so the reports are Drafts too.</p>
        )}
      </div>
      {last?.errors.map((e) => (
        <p key={e.kind} className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2 text-sm text-destructive" role="alert">
          {e.kind === 'drr' ? 'DRR' : 'Sponsor-wise'} report not made: {e.message}
        </p>
      ))}
      {last?.files.flatMap((f) => f.notes.map((n, i) => (
        <p key={`${f.kind}-${i}`} className="text-sm text-amber-700">
          {f.fileName}: {n}
        </p>
      )))}
    </div>
  );
}
