import { Loader2 } from 'lucide-react';
import { Suspense, lazy, useMemo, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GROUP_LEVELS, LEVEL_LABELS, trend, type TrendLevel } from '@/core/history';
import { MEASURES, getMeasure } from '@/core/measures';
import type { MeasureCode } from '@/core/types';
import type { MonthOverview } from '@/storage/history';

const TrendChart = lazy(() => import('./TrendChart'));

const WINDOW = 12;

/** One measure over the last 12 months, overall or by doctor, department or sponsor. */
export function TrendView({ overviews }: { overviews: readonly MonthOverview[] }) {
  const [measure, setMeasure] = useState<MeasureCode>('TOTAL_REVENUE');
  const [level, setLevel] = useState<TrendLevel>('overall');

  // The newest 12 months that have data, each from its best run.
  const data = useMemo(
    () => overviews.flatMap((o) => (o.bestData ? [o.bestData] : [])).sort((a, b) => a.month.localeCompare(b.month)).slice(-WINDOW),
    [overviews],
  );
  const series = useMemo(() => trend(data, level, measure), [data, level, measure]);
  const drafts = data.filter((d) => d.status === 'Draft').map((d) => d.month);

  if (data.length === 0) {
    return <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">There is no saved month to draw yet.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Measure</span>
          <Select value={measure} onValueChange={(v) => setMeasure(v as MeasureCode)}>
            <SelectTrigger className="w-64" aria-label="Measure">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEASURES.map((m) => (
                <SelectItem key={m.code} value={m.code}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Level</span>
          <Select value={level} onValueChange={(v) => setLevel(v as TrendLevel)}>
            <SelectTrigger className="w-44" aria-label="Level">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="overall">All together</SelectItem>
              {GROUP_LEVELS.map((l) => (
                <SelectItem key={l} value={l}>
                  By {LEVEL_LABELS[l].toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        The last {data.length} saved month{data.length === 1 ? '' : 's'}, each from its newest Final run
        {drafts.length > 0 ? ` (${drafts.join(', ')} ${drafts.length === 1 ? 'has' : 'have'} no Final run, so the newest Draft is used)` : ''}.
        {level !== 'overall' && ' The 8 largest are drawn; click a name in the legend to hide it.'}
      </p>

      {series.series.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">These months have no {level} data (an imported month has no sponsors).</p>
      ) : (
        <Suspense
          fallback={
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading the chart…
            </p>
          }
        >
          <TrendChart trend={series} code={measure} label={`${getMeasure(measure).label} by month`} />
        </Suspense>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer select-none text-muted-foreground">Show the numbers</summary>
        <div className="mt-2 overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th className="px-3 py-1.5 font-medium">{level === 'overall' ? '' : LEVEL_LABELS[level]}</th>
                {series.months.map((m) => (
                  <th key={m} className="px-3 py-1.5 text-right font-medium">
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series.series.map((s) => (
                <tr key={s.name} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{s.name}</td>
                  {s.points.map((p, i) => (
                    <td key={i} className="px-3 py-1.5 text-right tabular-nums">
                      {p === null ? '' : getMeasure(measure).kind === 'count' ? p : (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
