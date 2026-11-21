import type { ColDef } from 'ag-grid-community';
import { useMemo } from 'react';
import { formatINR } from '@/core/money';
import { DataGrid } from '@/components/DataGrid';
import type { ReportColumnInfo, ReportRow } from '@/engine/report';

/** The report as an AG Grid: money shown in rupees, the totals row pinned at the bottom. */
export function ReportGrid({ columns, rows, totals, height = 380 }: { columns: readonly ReportColumnInfo[]; rows: ReportRow[]; totals: ReportRow | null; height?: number }) {
  const defs = useMemo<ColDef<ReportRow>[]>(
    () =>
      columns.map((c) => ({
        headerName: c.name,
        field: c.name,
        minWidth: c.type === 'text' || c.type === 'date' ? 140 : 120,
        type: c.type === 'money' || c.type === 'number' ? 'rightAligned' : undefined,
        pinned: c.kind === 'serial' ? ('left' as const) : undefined,
        valueFormatter: c.type === 'money' ? (p) => (typeof p.value === 'number' ? formatINR(p.value) : '') : undefined,
      })),
    [columns],
  );
  return (
    <div className="overflow-hidden rounded-lg border">
      <DataGrid<ReportRow> rows={rows} columns={defs} totals={totals ? [totals] : undefined} height={height} />
    </div>
  );
}
