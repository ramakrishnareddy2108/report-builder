// Fill the DRR / Sponsor-wise templates (table fill, not placeholders).
//
// - The header row is found by header names; one row per doctor (or sponsor) is
//   written from the first data row, into the input columns only.
// - The template's formula cells (Total Revenue, Gross Profit) are kept; their
//   cached results are updated so the numbers show in any viewer.
// - Pre-numbered rows that are not needed are cleared (values only, formatting
//   and formulas stay). If more rows are needed, the last row's style and
//   formula pattern are copied down.
// - Amounts are written in rupees (paise / 100) once, here; text is escaped.

import type ExcelJS from 'exceljs';
import { MEASURES, measuresFor, type MeasureDef, type ReportKind } from '@/core/measures';
import { paiseToRupees } from '@/core/money';
import type { ReportRow } from '@/core/report';
import { escapeCell } from './escape';
import { TemplateError, formulaOf, type TemplateTable } from './templates';

/** "A".."Z", "AA"... for a 1-based column number. */
export function columnName(col: number): string {
  let n = col;
  let s = '';
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const headerOf = (kind: ReportKind, m: MeasureDef): string => (kind === 'drr' ? m.drrHeader : (m.sponsorHeader as string));

/** A calc column's formula for a row, in the template's own style: `+F5+G5+H5`, `+I5-J5-L5`. */
export function calcFormula(m: MeasureDef, row: number, columnOf: (code: MeasureDef['code']) => number | undefined): string {
  const calc = m.calc;
  if (!calc) throw new Error(`${m.code} is not a calculated measure`);
  const ref = (code: MeasureDef['code']) => {
    const c = columnOf(code);
    return c === undefined ? '' : `${columnName(c)}${row}`;
  };
  const plus = calc.plus.map(ref).filter(Boolean).map((r) => `+${r}`);
  const minus = calc.minus.map(ref).filter(Boolean).map((r) => `-${r}`);
  return [...plus, ...minus].join('');
}

/** The first of the month as an Excel date (midnight UTC, so it never slips to the day before). */
function monthStart(month: string): Date {
  const [y = 1970, m = 1] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

function copyRowStyle(sheet: ExcelJS.Worksheet, from: number, to: number, columns: number): void {
  const src = sheet.getRow(from);
  const dst = sheet.getRow(to);
  if (src.height !== undefined) dst.height = src.height;
  for (let c = 1; c <= columns; c++) {
    dst.getCell(c).style = JSON.parse(JSON.stringify(src.getCell(c).style)) as ExcelJS.Style;
  }
}

export type FillResult = {
  /** Things the user should know, such as a formula that had to be added. */
  notes: string[];
  rowsWritten: number;
  /** Rows the template already had that were cleared (no data for them). */
  rowsCleared: number;
  /** Rows added beyond the template's pre-made rows. */
  rowsAdded: number;
};

/** Cached SUBTOTAL ranges that end before the last data row: the totals would miss rows. */
function subtotalProblems(table: TemplateTable, lastDataRow: number): string[] {
  const out: string[] = [];
  for (let r = 1; r < table.headerRow; r++) {
    table.sheet.getRow(r).eachCell((cell) => {
      const f = formulaOf(cell);
      const m = f ? /SUBTOTAL\(\s*\d+\s*,\s*\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?(\d+)\s*\)/i.exec(f) : null;
      if (m && Number(m[1]) < lastDataRow) {
        out.push(`The totals in row ${r} (${cell.address}) only add up to row ${m[1]}, but the data goes to row ${lastDataRow}. Extend the SUBTOTAL range in the template.`);
      }
    });
  }
  return out;
}

/** Fill the template's table with the report rows. Modifies `table.workbook`. */
export function fillTable(table: TemplateTable, kind: ReportKind, rows: readonly ReportRow[]): FillResult {
  if (table.missing.length > 0) {
    throw new TemplateError(`The template has no column for: ${table.missing.join(', ')}. Use the original template, or restore the missing headers.`);
  }
  const { sheet, columns } = table;
  const col = (header: string): number => columns.get(header) as number; // all present: checked above
  const measures = measuresFor(kind);
  const columnOf = (code: MeasureDef['code']): number | undefined => {
    const def = MEASURES.find((m) => m.code === code);
    const header = def ? (kind === 'drr' ? def.drrHeader : def.sponsorHeader) : null;
    return header ? columns.get(header) : undefined;
  };
  const inputs = measures.filter((m) => m.kind !== 'calc');
  const calcs = measures.filter((m) => m.kind === 'calc');

  const nameHeader = kind === 'drr' ? 'Doctor Name' : 'Sponsor Name';
  const lastColumn = Math.max(...columns.values());
  const notes: string[] = [];
  const when = monthStart(rows[0]?.month ?? '1970-01');

  const lastDataRow = table.firstDataRow + rows.length - 1;
  for (const p of subtotalProblems(table, lastDataRow)) notes.push(p);

  let added = 0;
  rows.forEach((row, i) => {
    const r = table.firstDataRow + i;
    if (r > table.lastTemplateRow) {
      copyRowStyle(sheet, table.lastTemplateRow, r, lastColumn);
      added++;
    }
    const line = sheet.getRow(r);
    line.getCell(col('S.No.')).value = row.sNo;
    line.getCell(col(nameHeader)).value = escapeCell(row.name);
    if (kind === 'drr') line.getCell(col('Department')).value = escapeCell(row.department) || null;
    const monthCell = line.getCell(col('Month'));
    monthCell.value = when;
    if (!monthCell.numFmt) monthCell.numFmt = 'mmm-yy';

    for (const m of inputs) {
      line.getCell(col(headerOf(kind, m))).value = m.kind === 'count' ? row.values[m.code] : paiseToRupees(row.values[m.code]);
    }
    for (const m of calcs) {
      const cell = line.getCell(col(headerOf(kind, m)));
      const existing = formulaOf(cell);
      const formula = existing ?? calcFormula(m, r, columnOf);
      // Rows added below the template get their formula by design; only a pre-made row without one is worth a note.
      if (!existing && r <= table.lastTemplateRow) notes.push(`Row ${r}: the template had no formula for ${headerOf(kind, m)}, so ${formula} was added.`);
      cell.value = { formula, result: paiseToRupees(row.values[m.code]) };
    }
  });

  // Rows of the template that are not needed: clear what was typed, keep formatting and formulas.
  let cleared = 0;
  for (let r = table.firstDataRow + rows.length; r <= table.lastTemplateRow; r++) {
    const line = sheet.getRow(r);
    const clear = (header: string) => {
      line.getCell(col(header)).value = null;
    };
    clear('S.No.');
    clear(nameHeader);
    if (kind === 'drr') clear('Department');
    clear('Month');
    for (const m of inputs) clear(headerOf(kind, m));
    for (const m of calcs) {
      const cell = line.getCell(col(headerOf(kind, m)));
      const f = formulaOf(cell);
      if (f) cell.value = { formula: f, result: 0 };
    }
    cleared++;
  }
  return { notes, rowsWritten: rows.length, rowsCleared: cleared, rowsAdded: added };
}
