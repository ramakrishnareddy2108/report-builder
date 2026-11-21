import { ArrowDown, ArrowUp, Loader2, Minus } from 'lucide-react';
import { Suspense, lazy } from 'react';
import type { TileData } from '@/core/dashboard';
import { tileTable } from '@/core/dashboardTable';
import { formatINR } from '@/core/money';
import type { Tile } from '@/core/schemas';
import { showValue } from './tileOption';

const TileChart = lazy(() => import('./TileChart'));

type Props = { tile: Tile; data: TileData; onChartReady: (toPng: () => string) => void };

/** The inside of a tile: numbers, a table, or a chart. */
export function TileBody({ tile, data, onChartReady }: Props) {
  if (data.status !== 'ok') {
    return (
      <p className={`rounded-lg border border-dashed px-4 py-8 text-center text-sm ${data.status === 'unsupported' ? 'text-destructive' : 'text-muted-foreground'}`} role={data.status === 'unsupported' ? 'alert' : undefined}>
        {data.message}
      </p>
    );
  }
  if (tile.type === 'kpi') return <Kpis data={data} />;
  if (tile.type === 'table') return <TileTableView tile={tile} data={data} />;
  return (
    <Suspense
      fallback={
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading the chart…
        </p>
      }
    >
      <TileChart tile={tile} data={data} onReady={onChartReady} />
    </Suspense>
  );
}

/** One big number per measure, with the change against the comparison month. */
function Kpis({ data }: { data: TileData }) {
  const values = data.series[0]?.values ?? [];
  const before = data.compare?.series[0]?.values ?? [];
  return (
    <div className="flex flex-wrap gap-x-10 gap-y-4">
      {data.categories.map((c, i) => {
        const now = values[i] ?? null;
        const prev = before[i] ?? null;
        const change = now !== null && prev !== null ? now - prev : null;
        const percent = change !== null && prev !== null && prev !== 0 ? (change / Math.abs(prev)) * 100 : null;
        return (
          <div key={c.key}>
            <div className="text-xs text-muted-foreground">{c.label}</div>
            <div className="text-3xl font-semibold tabular-nums">{now === null ? '—' : showValue(data.unit, now)}</div>
            {data.compare && (
              <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground" aria-label={`Change against ${data.compare.month}`}>
                {change === null ? (
                  <span>No figure for {data.compare.month}</span>
                ) : (
                  <>
                    {change > 0 ? <ArrowUp className="size-3.5 text-emerald-600" aria-hidden /> : change < 0 ? <ArrowDown className="size-3.5 text-red-600" aria-hidden /> : <Minus className="size-3.5" aria-hidden />}
                    <span className="tabular-nums">
                      {data.unit === 'money' ? formatINR(Math.abs(change)) : Math.abs(change)}
                      {percent !== null && ` (${percent > 0 ? '+' : ''}${percent.toFixed(1)}%)`}
                    </span>
                    <span>against {data.compare.month}</span>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TileTableView({ tile, data }: { tile: Tile; data: TileData }) {
  const table = tileTable(tile, data);
  const cell = (kind: (typeof table.columns)[number]['kind'], v: string | number | null) => {
    if (v === null) return '';
    if (typeof v === 'string') return v;
    if (kind === 'money') return formatINR(v, { symbol: false });
    if (kind === 'percent') return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  };
  return (
    <div className="max-h-96 overflow-auto rounded-lg border">
      <table className="w-full text-sm">
        <caption className="sr-only">{tile.title}</caption>
        <thead className="sticky top-0 bg-muted/60">
          <tr className="text-left">
            {table.columns.map((c, i) => (
              <th key={i} scope="col" className={`px-3 py-1.5 font-medium ${i > 0 ? 'text-right' : ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r} className="border-t">
              {row.map((v, i) => (
                <td key={i} className={`px-3 py-1.5 ${i > 0 ? 'text-right tabular-nums' : ''}`}>
                  {cell(table.columns[i]?.kind ?? 'text', v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
