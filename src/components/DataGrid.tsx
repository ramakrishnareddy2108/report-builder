import { AllCommunityModule, ModuleRegistry, type ColDef, type GridOptions } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useMemo } from 'react';

ModuleRegistry.registerModules([AllCommunityModule]);

type Props<T> = {
  rows: T[];
  columns: ColDef<T>[];
  /** Pixel height of the grid. */
  height?: number;
  /** A totals row pinned under the data. */
  totals?: T[];
  getRowId?: (row: T) => string;
  options?: GridOptions<T>;
};

/** AG Grid with the project defaults: sortable, resizable, keyboard navigable. */
export function DataGrid<T>({ rows, columns, height = 360, totals, getRowId, options }: Props<T>) {
  const defaultColDef = useMemo<ColDef<T>>(() => ({ sortable: true, resizable: true, minWidth: 90 }), []);
  return (
    <div style={{ height }} className="w-full">
      <AgGridReact<T>
        rowData={rows}
        columnDefs={columns}
        defaultColDef={defaultColDef}
        pinnedBottomRowData={totals}
        getRowId={getRowId ? (p) => getRowId(p.data) : undefined}
        {...options}
      />
    </div>
  );
}
