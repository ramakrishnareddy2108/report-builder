import { Lock } from 'lucide-react';
import { openRun, useRun } from '@/app/runSession';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Workspace } from '@/storage/workspace';

/** Runs already saved for the month; a Final run opens read-only. */
export function SavedRunsList({ ws }: { ws: Workspace }) {
  const runs = useRun((s) => s.savedRuns);
  const open = useRun((s) => s.result?.saved?.runNumber);
  const busy = useRun((s) => s.status === 'running');

  if (runs.length === 0) return <p className="text-sm text-muted-foreground">No run has been saved for this month yet.</p>;
  return (
    <ul className="divide-y rounded-lg border" aria-label="Saved runs">
      {[...runs].reverse().map((r) => (
        <li key={r.runNumber} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
          <span className="text-sm font-medium">Run {r.runNumber}</span>
          {r.info ? (
            <>
              <Badge variant={r.info.status === 'Final' ? 'default' : 'secondary'}>
                {r.info.status === 'Final' && <Lock />}
                {r.info.status}
              </Badge>
              {r.info.kind === 'summary' && <Badge variant="outline">Imported</Badge>}
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                {r.info.operatorName || 'Unknown'}, {new Date(r.info.createdAt).toLocaleString('en-IN')}
                {r.info.reason ? `. Reason: ${r.info.reason}` : ''}
              </span>
            </>
          ) : (
            <span className="flex-1 text-xs text-destructive">{r.error ?? 'Its run-info.json is missing.'}</span>
          )}
          <Button variant="outline" size="sm" disabled={busy || !r.info || r.info.kind === 'summary' || open === r.runNumber} onClick={() => void openRun(ws, r.runNumber)}>
            {open === r.runNumber ? 'Showing' : r.info?.kind === 'summary' ? 'No details' : 'Open'}
          </Button>
        </li>
      ))}
    </ul>
  );
}
