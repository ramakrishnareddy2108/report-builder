import type { ColDef } from 'ag-grid-community';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { lazy, Suspense, useMemo } from 'react';
import { DataGrid } from '@/components/DataGrid';
import { formatValue } from '@/dashboard/chartOption';
import type { Tile } from '@/dashboard/schema';
import type { TileResult } from '@/dashboard/tiles';
import { cn } from '@/lib/utils';

const TileChart = lazy(() => import('./TileChart'));

function Notes({ notes }: { notes: readonly string[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
      {notes.map((n, i) => (
        <li key={i}>{n}</li>
      ))}
    </ul>
  );
}

function Change({ result }: { result: Extract<TileResult, { kind: 'kpi' }> }) {
  if (!result.period || result.change === null) return null;
  const up = result.change > 0;
  const flat = result.change === 0;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <p className={cn('mt-2 flex flex-wrap items-center gap-x-2 text-sm', flat ? 'text-muted-foreground' : up ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400')}>
      <span className="flex items-center gap-1 font-medium">
        <Icon className="size-4" aria-hidden />
        {up ? '+' : ''}
        {formatValue(result.format, result.change)}
        {result.changePct !== null && ` (${formatValue('percent', result.changePct)})`}
      </span>
      <span className="text-muted-foreground">
        {result.period.latest} vs {result.period.previous}
      </span>
    </p>
  );
}

type Props = { tile: Tile; result: TileResult; onChartReady?: (toPng: () => string) => void };

/** What a tile shows: a big number, a chart, or a table. A problem is said in plain words. */
export function TileBody({ tile, result, onChartReady }: Props) {
  const columns = useMemo<ColDef<Record<string, unknown>>[]>(
    () =>
      result.status === 'ok' && result.kind === 'table'
        ? result.columns.map((c) => ({
            headerName: c.label,
            field: c.key,
            minWidth: c.key === 'x' ? 150 : 110,
            type: c.format === 'text' ? undefined : 'rightAligned',
            valueFormatter: (p) => (c.format === 'text' ? String(p.value ?? '') : formatValue(c.format, p.value)),
          }))
        : [],
    [result],
  );

  if (result.status !== 'ok') {
    return (
      <p className={cn('rounded-md p-3 text-sm', result.status === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-muted/50 text-muted-foreground')} role={result.status === 'error' ? 'alert' : undefined}>
        {result.message}
      </p>
    );
  }

  if (result.kind === 'kpi') {
    return (
      <div>
        <p className="text-3xl font-semibold tracking-tight">{result.value === null ? '—' : formatValue(result.format, result.value)}</p>
        <Change result={result} />
        <Notes notes={result.notes} />
      </div>
    );
  }

  if (result.kind === 'chart') {
    return (
      <div>
        <Suspense fallback={<p className="py-10 text-center text-sm text-muted-foreground">Drawing…</p>}>
          <TileChart tile={tile} result={result} onReady={onChartReady} />
        </Suspense>
        <Notes notes={result.notes} />
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-hidden rounded-md border">
        <DataGrid<Record<string, unknown>> rows={result.rows} columns={columns} height={Math.min(320, 48 + 42 * Math.max(result.rows.length, 1))} />
      </div>
      <Notes notes={result.notes} />
    </div>
  );
}
