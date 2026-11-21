import type { ColDef } from 'ag-grid-community';
import { useMemo } from 'react';
import { DataGrid } from '@/components/DataGrid';
import { measuresFor, type ReportKind } from '@/core/measures';
import { formatINR } from '@/core/money';
import { reportTotals, type ReportRow } from '@/core/report';
import { UNATTRIBUTED_DOCTOR_ID } from '@/core/types';
import { UNMATCHED_KEY } from '@/core/aggregate';

type Props = { kind: ReportKind; rows: readonly ReportRow[] };

const isSpecial = (key: string) => key === UNMATCHED_KEY || key === UNATTRIBUTED_DOCTOR_ID;

/** The report as the Excel will have it: the same columns, with a totals row. */
export function ReportGrid({ kind, rows }: Props) {
  const measures = measuresFor(kind);

  const columns = useMemo<ColDef<ReportRow>[]>(() => {
    const lead: ColDef<ReportRow>[] = [
      { headerName: 'S.No.', field: 'sNo', width: 80, pinned: 'left' },
      { headerName: kind === 'drr' ? 'Doctor Name' : 'Sponsor Name', field: 'name', width: 240, pinned: 'left' },
      ...(kind === 'drr' ? [{ headerName: 'Department', field: 'department', width: 150 } satisfies ColDef<ReportRow>] : []),
      { headerName: 'Month', field: 'monthLabel', width: 110 },
    ];
    const values = measures.map((m): ColDef<ReportRow> => ({
      headerName: kind === 'drr' ? m.drrHeader : (m.sponsorHeader ?? m.label),
      colId: m.code,
      type: 'rightAligned',
      width: m.kind === 'count' ? 100 : 150,
      wrapHeaderText: true,
      autoHeaderHeight: true,
      valueGetter: (p) => p.data?.values[m.code],
      valueFormatter: (p) => (typeof p.value !== 'number' ? '' : m.kind === 'count' ? String(p.value) : formatINR(p.value, { symbol: false })),
      cellClass: (p) => [p.node.rowPinned ? 'font-semibold' : '', m.kind === 'calc' ? 'bg-muted/40' : ''].join(' '),
    }));
    return [...lead, ...values];
  }, [kind, measures]);

  const totals = useMemo<ReportRow[]>(
    () => [{ key: '__total__', sNo: 0, name: 'Total', department: '', month: '', monthLabel: '', values: reportTotals(rows) }],
    [rows],
  );

  return (
    <div className="space-y-2">
      <DataGrid
        rows={[...rows]}
        columns={columns}
        totals={totals}
        height={Math.min(620, 130 + rows.length * 42)}
        getRowId={(r) => r.key}
        options={{ getRowClass: (p) => (p.data && isSpecial(p.data.key) ? 'italic text-muted-foreground' : '') }}
      />
      <p className="text-xs text-muted-foreground">
        Amounts are in rupees. Total Revenue and Gross Profit (shaded) are calculated from the columns before them.
        {kind === 'drr' && ' Costs come from the Costs page.'}
      </p>
    </div>
  );
}
