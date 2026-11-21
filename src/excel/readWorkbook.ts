// Read source workbooks with SheetJS.
//
// Rows are returned as arrays aligned to real Excel rows and columns:
// rows[0] is Excel row 1 and rows[r][0] is column A, whatever the sheet's used
// range says. Formula cells give their cached (last calculated) value.

import * as XLSX from 'xlsx';

export type CellValue = string | number | boolean | Date | null;
export type Row = CellValue[];

export type SheetInfo = {
  name: string;
  /** Last Excel row that holds a value (0 for an empty sheet). */
  rowCount: number;
  /** Number of columns up to the last one that holds a value. */
  columnCount: number;
};

export type SheetReadStats = {
  /** Cells that hold a formula. */
  formulaCells: number;
  /** Formula cells saved without a calculated value; they read as blank. */
  formulaCellsWithoutValue: number;
  /** Cells holding an Excel error such as #DIV/0! (read as that text). */
  errorCells: number;
};

export type SheetRows = {
  sheet: string;
  /** rows[0] is Excel row 1; every row has `columnCount` cells (blank = null). */
  rows: Row[];
  rowCount: number;
  columnCount: number;
  stats: SheetReadStats;
};

/** A reading problem explained in plain language, safe to show to the user. */
export class WorkbookReadError extends Error {
  override name = 'WorkbookReadError';
}

const EXCEL_ERRORS: Readonly<Record<number, string>> = {
  0x00: '#NULL!',
  0x07: '#DIV/0!',
  0x0f: '#VALUE!',
  0x17: '#REF!',
  0x1d: '#NAME?',
  0x24: '#NUM!',
  0x2a: '#N/A',
  0x2b: '#GETTING_DATA',
};

/** Parse workbook bytes. Throws WorkbookReadError with a plain-language message. */
export function openWorkbook(data: ArrayBuffer | Uint8Array): XLSX.WorkBook {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length === 0) throw new WorkbookReadError('The file is empty.');
  try {
    return XLSX.read(bytes, {
      type: 'array',
      cellDates: true,
      dense: true,
      cellFormula: true,
      cellHTML: false,
      cellText: false,
      cellNF: false,
      cellStyles: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/password|encrypt/i.test(msg)) {
      throw new WorkbookReadError(
        'This file is password-protected. Open it in Excel, remove the password, save, and try again.',
      );
    }
    throw new WorkbookReadError(
      `This file could not be read as an Excel workbook. Check that it is an .xlsx or .xls export. (${msg})`,
    );
  }
}

function denseData(ws: XLSX.WorkSheet): (XLSX.CellObject[] | undefined)[] {
  return (ws['!data'] as (XLSX.CellObject[] | undefined)[] | undefined) ?? [];
}

type CellRead = { value: CellValue; formula: boolean; missingValue: boolean; error: boolean };

function readCell(cell: XLSX.CellObject | undefined): CellRead {
  if (!cell) return { value: null, formula: false, missingValue: false, error: false };
  const formula = typeof cell.f === 'string' && cell.f.length > 0;
  const v = cell.v;
  if (v === undefined || v === null || cell.t === 'z') {
    return { value: null, formula, missingValue: formula, error: false };
  }
  if (cell.t === 'e') {
    const text = typeof v === 'number' ? (EXCEL_ERRORS[v] ?? '#ERROR') : String(v);
    return { value: text, formula, missingValue: false, error: true };
  }
  if (v instanceof Date || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
    return { value: v, formula, missingValue: false, error: false };
  }
  return { value: String(v), formula, missingValue: false, error: false };
}

function isBlankValue(v: CellValue): boolean {
  return v === null || (typeof v === 'string' && v.trim() === '');
}

/** Used size of a sheet, measured from A1 by the cells that hold a value. */
function measure(ws: XLSX.WorkSheet): { rowCount: number; columnCount: number } {
  const data = denseData(ws);
  let rowCount = 0;
  let columnCount = 0;
  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    if (!row) continue;
    for (let c = row.length - 1; c >= 0; c--) {
      if (!isBlankValue(readCell(row[c]).value)) {
        rowCount = r + 1;
        if (c + 1 > columnCount) columnCount = c + 1;
        break;
      }
    }
  }
  return { rowCount, columnCount };
}

export function listSheets(wb: XLSX.WorkBook): SheetInfo[] {
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    return { name, ...(ws ? measure(ws) : { rowCount: 0, columnCount: 0 }) };
  });
}

function getSheet(wb: XLSX.WorkBook, sheet: string): XLSX.WorkSheet {
  const ws = wb.Sheets[sheet];
  if (!ws) {
    throw new WorkbookReadError(
      `The sheet “${sheet}” was not found. Sheets in this file: ${wb.SheetNames.map((s) => `“${s}”`).join(', ')}.`,
    );
  }
  return ws;
}

export type ReadSheetOptions = {
  /** Read only the first N Excel rows (for header previews). */
  maxRows?: number;
  /** Called every `progressEvery` rows with (rows done, total rows). */
  onProgress?: (done: number, total: number) => void;
  progressEvery?: number;
};

/** Read one sheet as rows aligned to Excel row numbers (rows[0] = row 1, column A first). */
export function readSheetRows(wb: XLSX.WorkBook, sheet: string, opts: ReadSheetOptions = {}): SheetRows {
  const ws = getSheet(wb, sheet);
  const data = denseData(ws);
  const size = measure(ws);
  const rowCount = opts.maxRows !== undefined ? Math.min(size.rowCount, opts.maxRows) : size.rowCount;
  const { columnCount } = size;
  const every = opts.progressEvery ?? 1000;
  const stats: SheetReadStats = { formulaCells: 0, formulaCellsWithoutValue: 0, errorCells: 0 };

  const rows: Row[] = new Array<Row>(rowCount);
  for (let r = 0; r < rowCount; r++) {
    const src = data[r];
    const out: Row = new Array<CellValue>(columnCount).fill(null);
    if (src) {
      const n = Math.min(src.length, columnCount);
      for (let c = 0; c < n; c++) {
        const cell = readCell(src[c]);
        out[c] = cell.value;
        if (cell.formula) stats.formulaCells++;
        if (cell.missingValue) stats.formulaCellsWithoutValue++;
        if (cell.error) stats.errorCells++;
      }
    }
    rows[r] = out;
    if (opts.onProgress && (r + 1) % every === 0) opts.onProgress(r + 1, rowCount);
  }
  opts.onProgress?.(rowCount, rowCount);
  return { sheet, rows, rowCount, columnCount, stats };
}
