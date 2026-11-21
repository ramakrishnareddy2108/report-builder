// A plain table as an Excel file (the "data to Excel" of a dashboard tile). Money is already in rupees here.

import ExcelJS from 'exceljs';
import { escapeCell } from './escape';

export type TableExportColumn = { header: string; format: 'text' | 'money' | 'number' | 'percent' };
export type TableExportInput = { title: string; columns: TableExportColumn[]; rows: (string | number | null)[][] };

const NUM_FMT: Record<TableExportColumn['format'], string | undefined> = {
  text: undefined,
  money: '#,##0.00;[Red]-#,##0.00',
  number: '#,##0.##;[Red]-#,##0.##',
  percent: '0.0"%"',
};

export async function buildTableWorkbook({ title, columns, rows }: TableExportInput): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow([escapeCell(title)]).font = { bold: true };
  const head = ws.addRow(columns.map((c) => escapeCell(c.header)));
  head.font = { bold: true };
  head.alignment = { wrapText: true, vertical: 'middle' };
  for (const row of rows) ws.addRow(row.map((cell) => (typeof cell === 'string' ? escapeCell(cell) : cell)));
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = i === 0 ? 34 : 18;
    const fmt = NUM_FMT[c.format];
    if (fmt) col.numFmt = fmt;
  });
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }];
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
