// The Compare view as an Excel file: one row per doctor / department / sponsor,
// and for every measure the two months, the change and the change percent.

import ExcelJS from 'exceljs';
import { LEVEL_LABELS, change, changePercent, type CompareRow, type GroupLevel } from '@/core/history';
import { MEASURES, type MeasureDef } from '@/core/measures';
import { paiseToRupees } from '@/core/money';
import { escapeCell } from './escape';

export type CompareExportInput = {
  monthA: string;
  monthB: string;
  level: GroupLevel;
  /** Measures to show (sponsor level has no cost columns). */
  measures: readonly MeasureDef['code'][];
  rows: readonly CompareRow[];
};

const MONEY = '#,##0.00;[Red]-#,##0.00';

export async function buildCompareWorkbook(input: CompareExportInput): Promise<Uint8Array> {
  const defs = input.measures.map((code) => MEASURES.find((m) => m.code === code) as MeasureDef);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Compare');

  ws.addRow([`${LEVEL_LABELS[input.level]}-wise: ${input.monthA} (A) against ${input.monthB} (B). Change = A − B. Amounts in rupees.`]);
  ws.getRow(1).font = { bold: true };

  const header = [LEVEL_LABELS[input.level]];
  for (const m of defs) header.push(`${m.label} A`, `${m.label} B`, `${m.label} change`, `${m.label} change %`);
  const headRow = ws.addRow(header);
  headRow.font = { bold: true };
  headRow.alignment = { wrapText: true, vertical: 'middle' };

  const value = (m: MeasureDef, paise: number | undefined | null): number | null =>
    paise === undefined || paise === null ? null : m.kind === 'count' ? paise : paiseToRupees(paise);

  for (const r of input.rows) {
    const cells: (string | number | null)[] = [escapeCell(r.name)];
    for (const m of defs) {
      const pct = changePercent(r, m.code);
      cells.push(value(m, r.a?.[m.code] ?? null), value(m, r.b?.[m.code] ?? null), value(m, change(r, m.code)), pct === null ? null : Math.round(pct * 10) / 10);
    }
    ws.addRow(cells);
  }

  ws.getColumn(1).width = 34;
  defs.forEach((m, i) => {
    for (let k = 0; k < 4; k++) {
      const col = ws.getColumn(2 + i * 4 + k);
      col.width = 14;
      col.numFmt = k === 3 ? '0.0"%"' : m.kind === 'count' ? '#,##0;[Red]-#,##0' : MONEY;
    }
  });
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }];
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
