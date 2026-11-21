import type { ColDef } from 'ag-grid-community';
import { useMemo } from 'react';
import { DataGrid } from '@/components/DataGrid';
import { formatINR } from '@/core/money';
import { FIELD_KINDS, FIELD_LABELS, type FieldKey } from '@/core/types';
import { SKIP_REASON_LABELS, type MappedRow, type MappedSheet } from '@/excel/mapSource';

export const PREVIEW_DATA_ROWS = 50;

type GridRow = MappedRow['values'] & { __row: number; __issues: MappedRow['issues'] };

/** The first rows as the tool will read them. Unreadable cells are highlighted. */
export function MappingPreview({ sheet, fields }: { sheet: MappedSheet; fields: readonly FieldKey[] }) {
  const rows = useMemo<GridRow[]>(
    () => sheet.rows.map((r) => ({ ...r.values, __row: r.row, __issues: r.issues })),
    [sheet],
  );

  const columns = useMemo<ColDef<GridRow>[]>(
    () => [
      { headerName: 'Row', field: '__row', width: 80, pinned: 'left' },
      ...fields.map((key): ColDef<GridRow> => {
        const money = FIELD_KINDS[key] === 'money';
        return {
          headerName: FIELD_LABELS[key].label,
          field: key,
          type: money ? 'rightAligned' : undefined,
          valueFormatter: money
            ? (p) => (typeof p.value === 'number' ? formatINR(p.value) : '')
            : undefined,
          cellClass: (p) => (p.data?.__issues.some((i) => i.field === key) ? 'bg-red-100 text-red-900' : ''),
          tooltipValueGetter: (p) => p.data?.__issues.find((i) => i.field === key)?.message,
        };
      }),
    ],
    [fields],
  );

  const bad = sheet.rows.filter((r) => r.issues.length > 0).length;
  const skipped = new Map<string, number>();
  for (const s of sheet.skipped) skipped.set(SKIP_REASON_LABELS[s.reason], (skipped.get(SKIP_REASON_LABELS[s.reason]) ?? 0) + 1);

  return (
    <div className="space-y-2">
      <DataGrid rows={rows} columns={columns} height={320} options={{ tooltipShowDelay: 300 }} />
      <p className="text-xs text-muted-foreground">
        First {sheet.rowsRead} rows: {sheet.rows.length} used
        {skipped.size > 0 && `, ${[...skipped].map(([why, n]) => `${n} skipped (${why.toLowerCase()})`).join(', ')}`}.
      </p>
      {bad > 0 && (
        <p className="text-xs text-destructive" role="alert">
          {bad} row{bad === 1 ? ' has' : 's have'} a value that cannot be read (shown in red). The run will list them in Checks.
        </p>
      )}
    </div>
  );
}
