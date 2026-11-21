import type { ColDef } from 'ag-grid-community';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { DataGrid } from '@/components/DataGrid';
import { costTotals, parseCostInput, type CostAmounts, type CostRow } from '@/core/costs';
import { formatINR } from '@/core/money';
import { COST_MEASURE_CODES, type CostMeasureCode, type DoctorMaster } from '@/core/types';
import { getMeasure } from '@/core/measures';

type GridRow = {
  doctorId: string;
  name: string;
  department: string;
  amounts: CostAmounts;
  note: string;
};

type Props = {
  doctors: readonly DoctorMaster[];
  rows: readonly CostRow[];
  onChange: (doctorId: string, patch: Partial<Pick<CostRow, 'amounts' | 'note'>>) => void;
};

const show = (paise: number | undefined) => (paise === undefined ? '' : formatINR(paise, { symbol: false }));

/** One row per doctor; the four costs are typed in rupees. A pinned row shows the totals. */
export function CostsGrid({ doctors, rows, onChange }: Props) {
  const gridRows = useMemo<GridRow[]>(() => {
    const byId = new Map(doctors.map((d) => [d.id, d]));
    return rows.map((r) => ({
      doctorId: r.doctorId,
      name: byId.get(r.doctorId)?.displayName ?? r.doctorId,
      department: byId.get(r.doctorId)?.department ?? '',
      amounts: r.amounts,
      note: r.note,
    }));
  }, [doctors, rows]);

  const totals = useMemo<GridRow[]>(
    () => [{ doctorId: '__total__', name: 'Total', department: '', amounts: costTotals(rows), note: '' }],
    [rows],
  );

  const columns = useMemo<ColDef<GridRow>[]>(
    () => [
      { headerName: 'Doctor', field: 'name', pinned: 'left', minWidth: 200, flex: 1 },
      { headerName: 'Department', field: 'department', minWidth: 130 },
      ...COST_MEASURE_CODES.map((code: CostMeasureCode): ColDef<GridRow> => ({
        headerName: `${getMeasure(code).label} (₹)`,
        colId: code,
        type: 'rightAligned',
        minWidth: 130,
        wrapHeaderText: true,
        autoHeaderHeight: true,
        editable: (p) => !p.node.rowPinned,
        // The cell shows (and edits) rupees as text; it is turned into paise once, here.
        valueGetter: (p) => show(p.data?.amounts[code]),
        valueSetter: (p) => {
          const parsed = parseCostInput(String(p.newValue ?? ''));
          if (!parsed.ok) {
            toast.error(`${p.data.name}, ${getMeasure(code).label}: ${parsed.message}`);
            return false;
          }
          const amounts = { ...p.data.amounts };
          if (parsed.paise === null) delete amounts[code];
          else amounts[code] = parsed.paise;
          onChange(p.data.doctorId, { amounts });
          return true;
        },
        cellClass: (p) => (p.node.rowPinned ? 'font-semibold' : ''),
      })),
      {
        headerName: 'Note for this change',
        field: 'note',
        minWidth: 200,
        flex: 1,
        editable: (p) => !p.node.rowPinned,
        valueSetter: (p) => {
          onChange(p.data.doctorId, { note: String(p.newValue ?? '') });
          return true;
        },
      },
    ],
    [onChange],
  );

  return (
    <DataGrid
      rows={gridRows}
      columns={columns}
      totals={totals}
      height={Math.min(640, 112 + gridRows.length * 42)}
      getRowId={(r) => r.doctorId}
      options={{
        stopEditingWhenCellsLoseFocus: true,
        enterNavigatesVertically: true,
        enterNavigatesVerticallyAfterEdit: true,
      }}
    />
  );
}
