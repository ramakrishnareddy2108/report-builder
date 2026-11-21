// A plain table as an Excel file (used by the dashboard tiles' "export to Excel").

import ExcelJS from 'exceljs';
import { paiseToRupees } from '@/core/money';
import type { TileTable } from '@/core/dashboardTable';
import { escapeCell } from './escape';

export type TableExportInput = { title: string; table: TileTable };

export async function buildTableWorkbook({ title, table }: TableExportInput): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow([escapeCell(title)]);
  ws.getRow(1).font = { bold: true };
  const head = ws.addRow(table.columns.map((c) => c.header));
  head.font = { bold: true };
  head.alignment = { wrapText: true, vertical: 'middle' };

  for (const row of table.rows) {
    ws.addRow(
      row.map((cell, i) => {
        const kind = table.columns[i]?.kind;
        if (cell === null) return null;
        if (typeof cell === 'string') return escapeCell(cell);
        return kind === 'money' ? paiseToRupees(cell) : cell; // money is turned into rupees only here
      }),
    );
  }

  table.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = i === 0 ? 34 : 18;
    if (c.kind === 'money') col.numFmt = '#,##0.00;[Red]-#,##0.00';
    else if (c.kind === 'count') col.numFmt = '#,##0.#;[Red]-#,##0.#';
    else if (c.kind === 'percent') col.numFmt = '0.0"%"';
  });
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }];
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
