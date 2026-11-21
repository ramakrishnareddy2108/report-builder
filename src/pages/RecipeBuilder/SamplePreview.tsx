import type { ColDef } from 'ag-grid-community';
import { useMemo } from 'react';
import { toIsoDate } from '@/core/dates';
import { DataGrid } from '@/components/DataGrid';
import { columnLetter } from '@/excel/detectHeader';
import type { CellValue, Row } from '@/excel/readWorkbook';
import type { Sample } from './sample';

type Line = { n: number; cells: Row };

function show(v: CellValue | undefined): string | number | boolean {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return toIsoDate(v) ?? v.toISOString();
  return v;
}

/** The first rows of the file, as it is (before any picking), with the header names and column letters. */
export function SamplePreview({ sample, height = 300 }: { sample: Sample; height?: number }) {
  const columns = useMemo<ColDef<Line>[]>(
    () => [
      { headerName: 'Row', field: 'n', width: 70, pinned: 'left', sortable: false },
      ...sample.headers.map((h, i): ColDef<Line> => ({
        headerName: `${columnLetter(i)} · ${h}`,
        valueGetter: (p) => show(p.data?.cells[i]),
        minWidth: 120,
        sortable: false,
      })),
    ],
    [sample.headers],
  );
  const rows = useMemo<Line[]>(() => sample.rows.map((cells, i) => ({ n: (sample.headerRow ?? 0) + 1 + i, cells })), [sample.rows, sample.headerRow]);

  if (sample.headers.length === 0) return <p className="text-sm text-muted-foreground">No header row was found. Set the header row above.</p>;
  return (
    <div className="overflow-hidden rounded-lg border">
      <DataGrid<Line> rows={rows} columns={columns} height={height} getRowId={(r) => String(r.n)} />
    </div>
  );
}
