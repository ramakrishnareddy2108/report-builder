// Reading a report template: find its table by header names, and its formulas.
//
// The DRR and Sponsor-wise templates have title rows, a header row (row 4), and
// pre-numbered rows below it that hold the Total Revenue and Gross Profit
// formulas. Headers are matched by text, ignoring case and spaces, so a moved
// or reordered column is still found.

import ExcelJS from 'exceljs';
import { DRR_HEADERS, SPONSOR_HEADERS, type ReportKind } from '@/core/measures';

export class TemplateError extends Error {
  override name = 'TemplateError';
}

/** Header text compared ignoring case and spaces. */
export const headerKey = (text: string): string => text.replace(/\s+/g, '').toLowerCase();

export function expectedHeaders(kind: ReportKind): readonly string[] {
  return kind === 'drr' ? DRR_HEADERS : SPONSOR_HEADERS;
}

export type TemplateTable = {
  workbook: ExcelJS.Workbook;
  sheet: ExcelJS.Worksheet;
  /** 1-based row of the header. */
  headerRow: number;
  /** Column (1-based) of each expected header, by its exact expected text. */
  columns: ReadonlyMap<string, number>;
  /** Expected headers the template does not have. */
  missing: readonly string[];
  firstDataRow: number;
  /** Last pre-made row: the last row holding a serial number or a formula in the table. */
  lastTemplateRow: number;
};

const HEADER_SCAN_ROWS = 20;

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((t) => t.text).join('');
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '');
  return String(v);
}

/** The formula text of a cell (shared formulas are translated by ExcelJS), or null if it is not a formula. */
export function formulaOf(cell: ExcelJS.Cell): string | null {
  const v = cell.value;
  if (v !== null && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) return cell.formula || null;
  return null;
}

export async function openTemplate(bytes: ArrayBuffer | Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as ArrayBuffer);
  } catch {
    throw new TemplateError('This file could not be read as an Excel workbook. Use the original template (.xlsx).');
  }
  return workbook;
}

/** Find the table in the first sheet that holds the report headers. */
export function findTable(workbook: ExcelJS.Workbook, kind: ReportKind): TemplateTable {
  const expected = expectedHeaders(kind);
  let best: { sheet: ExcelJS.Worksheet; row: number; found: Map<string, number> } | null = null;

  for (const sheet of workbook.worksheets) {
    for (let r = 1; r <= Math.min(HEADER_SCAN_ROWS, sheet.rowCount); r++) {
      const byKey = new Map<string, number>();
      sheet.getRow(r).eachCell((cell, col) => {
        const key = headerKey(cellText(cell));
        if (key !== '' && !byKey.has(key)) byKey.set(key, col);
      });
      const found = new Map<string, number>();
      for (const h of expected) {
        const col = byKey.get(headerKey(h));
        if (col !== undefined) found.set(h, col);
      }
      if (!best || found.size > best.found.size) best = { sheet, row: r, found };
    }
  }

  if (!best || best.found.size < Math.ceil(expected.length / 2)) {
    throw new TemplateError(
      `No table with the ${kind === 'drr' ? 'DRR' : 'Sponsor-wise'} headers (${expected.slice(0, 4).join(', ')}, …) was found in the first ${HEADER_SCAN_ROWS} rows. Check that this is the right template.`,
    );
  }

  const columns = best.found;
  const missing = expected.filter((h) => !columns.has(h));
  const calcColumns = [columns.get('S.No.'), columns.get('Total Revenue'), columns.get('Gross Profit')].filter((c): c is number => c !== undefined);
  let last = best.row;
  for (let r = best.row + 1; r <= best.sheet.rowCount; r++) {
    const row = best.sheet.getRow(r);
    if (calcColumns.some((c) => {
      const v = row.getCell(c).value;
      return v !== null && v !== undefined && v !== '';
    })) last = r;
  }
  return { workbook, sheet: best.sheet, headerRow: best.row, columns, missing, firstDataRow: best.row + 1, lastTemplateRow: last };
}

/** Open a template and find its table. Throws TemplateError with a plain message. */
export async function loadTemplate(bytes: ArrayBuffer | Uint8Array, kind: ReportKind): Promise<TemplateTable> {
  return findTable(await openTemplate(bytes), kind);
}
