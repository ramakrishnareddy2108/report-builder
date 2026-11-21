import { FileDown, Lock } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { downloadRunAgain } from '@/app/monthActions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatINR } from '@/core/money';
import { monthLabel } from '@/core/dates';
import { plural } from '@/lib/plural';
import type { MonthOverview } from '@/storage/history';
import type { Workspace } from '@/storage/workspace';

/** Every saved month: its newest run, status, totals and checks, with a button to download its reports again. */
export function MonthsTable({ ws, overviews }: { ws: Workspace; overviews: readonly MonthOverview[] }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function download(month: string, runNumber: number) {
    const key = `${month}/${runNumber}`;
    setBusy(key);
    try {
      const built = await downloadRunAgain(ws, month, runNumber);
      if (built.files.length > 0) toast.success(`Made ${built.files.map((f) => f.fileName).join(' and ')} from run ${runNumber}. A copy is in output/${month}/.`);
      for (const e of built.errors) toast.error(`${e.kind === 'drr' ? 'DRR' : 'Sponsor-wise'} report not made: ${e.message}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[56rem] text-sm">
        <caption className="sr-only">Saved months</caption>
        <thead>
          <tr className="border-b bg-muted/40 text-left text-muted-foreground">
            <th className="px-4 py-2 font-medium">Month</th>
            <th className="px-4 py-2 font-medium">Latest run</th>
            <th className="px-4 py-2 text-right font-medium">Total Revenue</th>
            <th className="px-4 py-2 text-right font-medium">Gross Profit</th>
            <th className="px-4 py-2 text-right font-medium">Fails</th>
            <th className="px-4 py-2 text-right font-medium">Warnings</th>
            <th className="px-4 py-2 font-medium">
              <span className="sr-only">Reports</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {overviews.map((o) => {
            const d = o.latestData;
            const info = o.latest?.info;
            return (
              <tr key={o.month} className="border-b last:border-0">
                <td className="px-4 py-2.5 font-medium">
                  {monthLabel(o.month)}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{o.month}</span>
                </td>
                <td className="px-4 py-2.5">
                  {o.error ? (
                    <span className="text-destructive" role="alert">
                      {o.error}
                    </span>
                  ) : info ? (
                    <span className="flex flex-wrap items-center gap-2">
                      Run {info.runNumber}
                      <Badge variant={info.status === 'Final' ? 'default' : 'secondary'}>
                        {info.status === 'Final' && <Lock />}
                        {info.status}
                      </Badge>
                      {info.kind === 'summary' && <Badge variant="outline">Imported</Badge>}
                      {o.runs.length > 1 && <span className="text-xs text-muted-foreground">of {plural(o.runs.length, 'run')}</span>}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No readable run</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{d ? formatINR(d.totals.TOTAL_REVENUE) : '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{d ? formatINR(d.totals.GROSS_PROFIT) : '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{d?.checks ? d.checks.fail : '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{d?.checks ? d.checks.warning : '—'}</td>
                <td className="px-4 py-2.5 text-right">
                  {info && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy !== null || info.kind === 'summary'}
                      title={info.kind === 'summary' ? 'An imported month has no fact rows, so its reports cannot be made again.' : undefined}
                      onClick={() => void download(o.month, info.runNumber)}
                    >
                      <FileDown />
                      {busy === `${o.month}/${info.runNumber}` ? 'Making…' : 'Download reports'}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
