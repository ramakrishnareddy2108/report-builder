import { CircleAlert, FileSpreadsheet, History, X } from 'lucide-react';
import { useSession } from '@/app/sessionStore';
import { FileDrop } from '@/components/FileDrop';
import { ProgressBar } from '@/components/ProgressBar';
import { Button } from '@/components/ui/button';
import { useDash } from './dashStore';

/** Where the dashboard's numbers come from: the last report of this session, or saved report files. */
export function DataBar() {
  const { data, loading, error } = useDash();
  const loadSession = useDash((s) => s.loadSession);
  const loadFiles = useDash((s) => s.loadFiles);
  const clearData = useDash((s) => s.clearData);
  const last = useSession((s) => s.lastReport);

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="data-h">
      <div>
        <h2 id="data-h" className="text-base font-semibold">
          Data
        </h2>
        <p className="text-sm text-muted-foreground">Your data stays in this browser tab. It is never saved. Only the dashboard layout is.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={loadSession}
          disabled={!last || loading}
          className="flex min-h-16 items-center gap-3 rounded-lg border p-3 text-left text-sm hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <History className="size-5 shrink-0 text-primary" aria-hidden />
          <span>
            <b className="block">Use the last generated report</b>
            <span className="text-muted-foreground">{last ? `${last.recipeName}${last.period ? ` · ${last.period}` : ''}` : 'Nothing has been generated in this session yet.'}</span>
          </span>
        </button>
        <FileDrop onFiles={(f) => void loadFiles(f)} title="Upload saved report files" hint="One or more finished reports, such as 3 months of DRR" disabled={loading} compact />
      </div>

      {loading && <ProgressBar fraction={0.5} label="Reading the files…" />}
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
        </p>
      )}

      {data.sources.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{data.rows.length.toLocaleString('en-IN')} rows loaded</p>
            <Button variant="ghost" size="sm" onClick={clearData}>
              <X className="size-4" /> Clear
            </Button>
          </div>
          <ul className="divide-y rounded-lg border text-sm">
            {data.sources.map((s, i) => (
              <li key={`${s.name}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2.5">
                <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 break-words">{s.name}</span>
                {s.message ? (
                  <span className="text-xs text-destructive">{s.message}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {s.rows.toLocaleString('en-IN')} rows · {s.period}
                    {s.skipped > 0 && ` · ${s.skipped} totals row${s.skipped === 1 ? '' : 's'} skipped`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
