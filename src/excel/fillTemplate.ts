// Fill an Excel template with the report (generic: the columns come from the recipe's report).
//
//  - The header row is found (set in the recipe, or auto = the row that matches the most report columns).
//    Report columns are matched to template headers by name, ignoring case and spaces.
//  - Data is written from the first row under the header.
//  - Template columns whose cells hold formulas are left alone (keepTemplateFormulas); their cached results are
//    updated so the numbers show in any viewer, and Excel recalculates everything when the file is opened.
//  - Pre-made rows that are not needed are cleared (values only: formatting and formulas stay).
//  - If the data has more rows than the template, the last pre-made row's formatting and formulas are copied down.
//  - Cross-check: the template's row formulas are evaluated on the report values and compared with the report's own
//    formula columns. A difference is a Warning.
//  - Money is written in rupees (paise / 100) and text is escaped, see cells.ts.

import type ExcelJS from 'exceljs';
import ExcelJSLib from 'exceljs';
import type { ReportResult } from '@/engine/report';
import type { IssueLevel } from '@/engine/types';
import { compileFormula, type Value } from '@/formula';
import type { OutputDef } from '@/recipe/schema';
import { columnIndex, columnLetter } from './detectHeader';
import { toCellValue } from './cells';

export type TemplateOutput = Extract<OutputDef, { mode: 'template' }>;

export class TemplateError extends Error {
  override name = 'TemplateError';
}

export type MappingStatus = 'matched' | 'formula-kept' | 'unmatched';

export type TemplateMappingEntry = {
  reportColumn: string;
  /** The header text found in the template, or null when there is none. */
  templateHeader: string | null;
  /** 1-based template column, or null. */
  templateColumn: number | null;
  status: MappingStatus;
};

export type TemplateNote = { level: IssueLevel; message: string };

export type TemplateInspection = {
  workbook: ExcelJS.Workbook;
  sheet: ExcelJS.Worksheet;
  headerRow: number;
  firstDataRow: number;
  /** Last pre-made row of the table (rows that already hold numbers or formulas); firstDataRow - 1 when there are none. */
  lastTemplateRow: number;
  mapping: TemplateMappingEntry[];
};

export type FillResult = {
  notes: TemplateNote[];
  mapping: TemplateMappingEntry[];
  rowsWritten: number;
  rowsCleared: number;
  rowsAdded: number;
};

const HEADER_SCAN_ROWS = 20;

/** Header text compared ignoring case and spaces. */
export const headerKey = (text: string): string => text.replace(/\s+/g, '').toLowerCase();

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((t) => t.text).join('');
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '');
  if (v instanceof Date) return '';
  return String(v);
}

/** The formula text of a cell (shared formulas are translated by ExcelJS), or null if it is not a formula. */
export function formulaOf(cell: ExcelJS.Cell): string | null {
  const v = cell.value;
  if (v !== null && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) return cell.formula || null;
  return null;
}

const isEmpty = (cell: ExcelJS.Cell) => cell.value === null || cell.value === undefined || cell.value === '';

export async function openTemplateWorkbook(bytes: ArrayBuffer | Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJSLib.Workbook();
  try {
    await workbook.xlsx.load(bytes as ArrayBuffer);
  } catch {
    throw new TemplateError('The template could not be read as an Excel workbook. Upload the template again (.xlsx).');
  }
  return workbook;
}

/** Shift the relative row numbers of A1 references: "F5+G5" by 2 → "F7+G7". `$F$5` keeps its row. */
export function shiftFormulaRows(formula: string, delta: number): string {
  return formula.replace(/(^|[^A-Za-z0-9_.])(\$?[A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (match, pre: string, col: string, abs: string, row: string) =>
    abs === '$' ? match : `${pre}${col}${abs}${Number(row) + delta}`,
  );
}

/** Where the report goes in the template and how each report column maps to a template column. Writes nothing. */
export function inspectTemplate(workbook: ExcelJS.Workbook, output: TemplateOutput, reportColumns: readonly string[]): TemplateInspection {
  const wanted = new Set(reportColumns.map(headerKey));
  const sheets = output.sheetName
    ? workbook.worksheets.filter((s) => s.name.toLowerCase() === output.sheetName?.toLowerCase())
    : workbook.worksheets;
  if (sheets.length === 0) {
    throw new TemplateError(`The template has no sheet called “${output.sheetName}”. Sheets: ${workbook.worksheets.map((s) => `“${s.name}”`).join(', ')}. Pick the sheet in Output.`);
  }

  let best: { sheet: ExcelJS.Worksheet; row: number; byKey: Map<string, number>; hits: number } | null = null;
  for (const sheet of sheets) {
    const rows = output.headerRow === 'auto' ? Array.from({ length: Math.min(HEADER_SCAN_ROWS, Math.max(sheet.rowCount, 1)) }, (_, i) => i + 1) : [output.headerRow];
    for (const r of rows) {
      const byKey = new Map<string, number>();
      sheet.getRow(r).eachCell((cell, col) => {
        const key = headerKey(cellText(cell));
        if (key !== '' && !byKey.has(key)) byKey.set(key, col);
      });
      const hits = [...wanted].filter((k) => byKey.has(k)).length;
      if (!best || hits > best.hits) best = { sheet, row: r, byKey, hits };
    }
  }
  if (!best || best.hits === 0) {
    throw new TemplateError(
      output.headerRow === 'auto'
        ? `No row in the first ${HEADER_SCAN_ROWS} rows of the template has any of the report's column names (${reportColumns.slice(0, 4).join(', ')}, …). Check that this is the right template.`
        : `Row ${output.headerRow} of the template has none of the report's column names (${reportColumns.slice(0, 4).join(', ')}, …). Set the header row in Output.`,
    );
  }

  const { sheet, row: headerRow, byKey } = best;
  const firstDataRow = headerRow + 1;
  const mapping: TemplateMappingEntry[] = reportColumns.map((name) => {
    const col = byKey.get(headerKey(name));
    if (col === undefined) return { reportColumn: name, templateHeader: null, templateColumn: null, status: 'unmatched' };
    const cell = sheet.getRow(firstDataRow).getCell(col);
    return {
      reportColumn: name,
      templateHeader: cellText(sheet.getRow(headerRow).getCell(col)).trim(),
      templateColumn: col,
      status: output.keepTemplateFormulas && formulaOf(cell) !== null ? 'formula-kept' : 'matched',
    };
  });

  // pre-made rows: the last row where a mapped column already holds a number, text or formula
  const mappedCols = mapping.flatMap((m) => (m.templateColumn === null ? [] : [m.templateColumn]));
  let last = headerRow;
  for (let r = firstDataRow; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (mappedCols.some((c) => !isEmpty(row.getCell(c)))) last = r;
  }
  return { workbook, sheet, headerRow, firstDataRow, lastTemplateRow: last, mapping };
}

function copyRowStyle(sheet: ExcelJS.Worksheet, from: number, to: number, columns: number): void {
  const src = sheet.getRow(from);
  const dst = sheet.getRow(to);
  if (src.height !== undefined) dst.height = src.height;
  for (let c = 1; c <= columns; c++) dst.getCell(c).style = JSON.parse(JSON.stringify(src.getCell(c).style)) as ExcelJS.Style;
}

/** SUBTOTAL ranges above the table that end before the last data row: the totals would miss rows. */
function subtotalProblems(sheet: ExcelJS.Worksheet, headerRow: number, lastDataRow: number): TemplateNote[] {
  const out: TemplateNote[] = [];
  for (let r = 1; r < headerRow; r++) {
    sheet.getRow(r).eachCell((cell) => {
      const f = formulaOf(cell);
      const m = f ? /SUBTOTAL\(\s*\d+\s*,\s*\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?(\d+)\s*\)/i.exec(f) : null;
      if (m && Number(m[1]) < lastDataRow) {
        out.push({ level: 'warning', message: `The totals in row ${r} (${cell.address}) only add up to row ${m[1]}, but the data goes to row ${lastDataRow}. Extend the SUBTOTAL range in the template.` });
      }
    });
  }
  return out;
}

/**
 * The template's row formula as our formula language, with this row's cells as column letters: "F5+G5+H5" → "F+G+H".
 * Returns null when the formula cannot be checked (other rows, ranges, unknown functions).
 */
function rowFormulaToExpression(formula: string, row: number): string | null {
  let ok = true;
  const text = formula.replace(/^=/, '').replace(/\$?([A-Z]{1,3})\$?(\d+)(?![\d(A-Za-z_])/g, (_, col: string, r: string) => {
    if (Number(r) !== row) ok = false;
    return `[${col}]`;
  });
  return ok && !text.includes(':') ? text : null;
}

export function fillTemplate(
  workbook: ExcelJS.Workbook,
  output: TemplateOutput,
  report: ReportResult,
): FillResult {
  const reportColumns = report.columns.map((c) => c.name);
  const t = inspectTemplate(workbook, output, reportColumns);
  const { sheet, headerRow, firstDataRow } = t;
  const notes: TemplateNote[] = [];
  const typeOf = new Map(report.columns.map((c) => [c.name, c.type] as const));

  for (const m of t.mapping.filter((x) => x.status === 'unmatched')) {
    notes.push({ level: 'warning', message: `The template has no column “${m.reportColumn}”, so that column of the report is not in the filled template.` });
  }
  const used = t.mapping.filter((m): m is TemplateMappingEntry & { templateColumn: number } => m.templateColumn !== null);
  const lastColumn = Math.max(1, ...used.map((m) => m.templateColumn));

  // the formula pattern of each kept column, from the last pre-made row (or the first data row)
  const patternRow = Math.max(t.lastTemplateRow, firstDataRow);
  const patterns = new Map<number, string>();
  for (const m of used.filter((x) => x.status === 'formula-kept')) {
    const f = formulaOf(sheet.getRow(patternRow).getCell(m.templateColumn)) ?? formulaOf(sheet.getRow(firstDataRow).getCell(m.templateColumn));
    if (f) patterns.set(m.templateColumn, shiftFormulaRows(f, firstDataRow - patternRow));
  }

  let added = 0;
  const lastDataRow = firstDataRow + report.rows.length - 1;
  notes.push(...subtotalProblems(sheet, headerRow, lastDataRow));

  const writeValue = (cell: ExcelJS.Cell, v: ReturnType<typeof toCellValue>) => {
    cell.value = v;
  };

  report.rows.forEach((row, i) => {
    const r = firstDataRow + i;
    if (r > t.lastTemplateRow && t.lastTemplateRow >= firstDataRow) {
      copyRowStyle(sheet, t.lastTemplateRow, r, lastColumn);
      added++;
    }
    const line = sheet.getRow(r);
    for (const m of used) {
      const cell = line.getCell(m.templateColumn);
      const value = toCellValue(row[m.reportColumn], typeOf.get(m.reportColumn) ?? 'text');
      if (m.status === 'formula-kept') {
        const existing = formulaOf(cell);
        // `patterns` are written for the first data row; rows below the template get them shifted down.
        const formula = existing ?? shiftFormulaRows(patterns.get(m.templateColumn) ?? '', r - firstDataRow);
        if (formula) cell.value = { formula, result: value instanceof Date ? undefined : (value ?? 0) };
        else writeValue(cell, value);
      } else {
        writeValue(cell, value);
        if (value instanceof Date && !cell.numFmt) cell.numFmt = 'dd-mmm-yyyy';
      }
    }
  });

  // pre-made rows that are not needed: clear what was typed, keep formatting and formulas
  let cleared = 0;
  for (let r = firstDataRow + report.rows.length; r <= t.lastTemplateRow; r++) {
    const line = sheet.getRow(r);
    for (const m of used) {
      const cell = line.getCell(m.templateColumn);
      const f = m.status === 'formula-kept' ? formulaOf(cell) : null;
      cell.value = f ? { formula: f, result: 0 } : null;
    }
    cleared++;
  }

  notes.push(...crossCheck(sheet, used, report, firstDataRow));

  // Excel recalculates every formula (including the SUBTOTALs above the table) when the file is opened.
  workbook.calcProperties.fullCalcOnLoad = true;

  return { notes, mapping: t.mapping, rowsWritten: report.rows.length, rowsCleared: cleared, rowsAdded: added };
}

/** Evaluate the template's row formulas on the report values and compare them with the report's formula columns. */
function crossCheck(
  sheet: ExcelJS.Worksheet,
  used: readonly (TemplateMappingEntry & { templateColumn: number })[],
  report: ReportResult,
  firstDataRow: number,
): TemplateNote[] {
  const notes: TemplateNote[] = [];
  const byLetter = new Map(used.map((m) => [columnLetter(m.templateColumn - 1), m] as const));
  const kindOf = new Map(report.columns.map((c) => [c.name, c.kind] as const));
  const typeOf = new Map(report.columns.map((c) => [c.name, c.type] as const));
  const toNumber = (v: string | number | null | undefined, type: string | undefined): number => (typeof v === 'number' ? (type === 'money' ? v / 100 : v) : 0);

  for (const m of used.filter((x) => x.status === 'formula-kept' && kindOf.get(x.reportColumn) === 'formula')) {
    const text = formulaOf(sheet.getRow(firstDataRow).getCell(m.templateColumn));
    const expression = text ? rowFormulaToExpression(text, firstDataRow) : null;
    if (!expression) {
      notes.push({ level: 'info', message: `The template formula for “${m.reportColumn}” uses other rows or ranges, so it could not be checked against the report.` });
      continue;
    }
    let compiled;
    try {
      compiled = compileFormula(expression);
    } catch {
      notes.push({ level: 'info', message: `The template formula for “${m.reportColumn}” (${text}) could not be checked against the report.` });
      continue;
    }
    if (compiled.columns.some((letter) => !byLetter.has(letter.toUpperCase()) || columnIndex(letter) === null)) {
      notes.push({ level: 'info', message: `The template formula for “${m.reportColumn}” uses columns that are not in the report, so it could not be checked.` });
      continue;
    }

    let mismatches = 0;
    let example = '';
    report.rows.forEach((row, i) => {
      const ctx = { getColumn: (letter: string): Value | undefined => {
        const e = byLetter.get(letter.toUpperCase());
        return e ? toNumber(row[e.reportColumn], typeOf.get(e.reportColumn)) : undefined;
      } };
      let expected: number;
      try {
        expected = Number(compiled.evaluate(ctx));
      } catch {
        return; // e.g. a divide by zero in the template: nothing to compare
      }
      const actual = toNumber(row[m.reportColumn], typeOf.get(m.reportColumn));
      if (Math.abs(expected - actual) > 0.005) {
        mismatches++;
        if (!example) example = ` For example on row ${firstDataRow + i}: the template gives ${expected.toFixed(2)}, the report ${actual.toFixed(2)}.`;
      }
    });
    if (mismatches > 0) {
      notes.push({
        level: 'warning',
        message: `The template formula for “${m.reportColumn}” (${text}) gives a different result from the report on ${mismatches} row${mismatches === 1 ? '' : 's'}.${example} Check the formula in the template or the recipe.`,
      });
    }
  }
  return notes;
}
