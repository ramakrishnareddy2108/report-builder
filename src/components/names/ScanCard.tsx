import { Loader2, ScanSearch } from 'lucide-react';
import { useNameScan, scanNames } from '@/app/nameScan';
import { useFiles } from '@/app/filesStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SOURCE_LABELS } from '@/core/types';

/** Reads the loaded files (in the background) to collect the names they use. */
export function ScanCard() {
  const scan = useNameScan();
  const fileCount = useFiles((s) => s.files.filter((f) => f.state === 'ready' && f.sourceId !== null).length);
  const scanning = scan.status === 'scanning';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Find names in this month’s files</CardTitle>
        <CardDescription>
          Reads the loaded files and lists every doctor, department and sponsor spelling with how often it appears.
          Names are only collected here; nothing is added to your lists until you accept it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void scanNames()} disabled={scanning || fileCount === 0}>
            {scanning ? <Loader2 className="animate-spin" /> : <ScanSearch />}
            {scanning ? 'Scanning…' : 'Scan loaded files'}
          </Button>
          {fileCount === 0 && (
            <p className="text-sm text-muted-foreground">
              No files are loaded yet. Drop this month’s Excel files on the Sources page first.
            </p>
          )}
        </div>

        {scanning && (
          <div className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round((scan.progress?.fraction ?? 0) * 100)}>
              <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${Math.round((scan.progress?.fraction ?? 0) * 100)}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              {scan.progress?.stage ?? 'Starting'}
              {scan.progress?.detail ? ` — ${scan.progress.detail}` : ''}
            </p>
          </div>
        )}

        {scan.status === 'error' && (
          <p className="text-sm text-destructive" role="alert">
            {scan.error}
          </p>
        )}

        {scan.unconfirmed.length > 0 && (
          <p className="text-sm text-amber-700">
            Not scanned, because their mapping is not confirmed yet: {scan.unconfirmed.map((s) => SOURCE_LABELS[s as keyof typeof SOURCE_LABELS]).join(', ')}.
            Confirm them on the Sources page.
          </p>
        )}

        {scan.result && (
          <ul className="space-y-0.5 text-sm">
            {scan.result.sources.map((s) => (
              <li key={s.sourceId} className={s.status === 'flagged' ? 'text-destructive' : 'text-muted-foreground'}>
                {SOURCE_LABELS[s.sourceId]}:{' '}
                {s.status === 'scanned' ? `${s.rows.toLocaleString('en-IN')} rows read` : s.message}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
