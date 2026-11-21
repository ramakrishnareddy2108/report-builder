// Dashboard data: the rows a dashboard draws, from the last report of this session or from saved report files.
//
// Money in the rows is in RUPEES here (a finished report file holds rupees), but sums are done in integer paise
// (see tiles.ts), so adding up never drifts. A "period" column (Month) is what comparisons use; a file without one gets
// its file name as the period.

import { monthLabel } from '@/core/dates';
import { istDateParts, toIsoDate } from '@/core/dates';
import type { ReportColumnInfo, ReportRow } from '@/engine/report';
import { detectHeaderRow, headersAt } from '@/excel/detectHeader';
import { isBlankCell } from '@/excel/convert';
import { listSheets, openWorkbook, readSheetRows, type CellValue } from '@/excel/readWorkbook';
import type { ColumnType, Recipe } from '@/recipe/schema';

export const PERIOD_COLUMN = 'Month';
export const FILE_COLUMN = '_file';

export type DashColumn = { name: string; type: ColumnType };
export type DashValue = string | number | null;
export type DashRow = Record<string, DashValue>;

export type DashboardData = {
  columns: DashColumn[];
  rows: DashRow[];
  /** Where the rows came from, for the summary line. */
  sources: { name: string; rows: number; skipped: number; period: string; message?: string }[];
};

export const emptyData = (): DashboardData => ({ columns: [], rows: [], sources: [] });

// ---------------------------------------------------------------------------
// From the report generated in this session
// ---------------------------------------------------------------------------

export function dataFromReport(report: { columns: readonly ReportColumnInfo[]; rows: readonly ReportRow[]; period: string; recipeName: string }): DashboardData {
  const columns: DashColumn[] = report.columns.filter((c) => c.kind !== 'serial').map((c) => ({ name: c.name, type: c.type }));
  const hasPeriod = columns.some((c) => c.name.toUpperCase() === PERIOD_COLUMN.toUpperCase());
  const period = report.period || 'This report';
  const rows: DashRow[] = report.rows.map((r) => {
    const out: DashRow = {};
    for (const c of columns) {
      const v = r[c.name] ?? null;
      out[c.name] = c.type === 'money' && typeof v === 'number' ? v / 100 : v;
    }
    if (!hasPeriod) out[PERIOD_COLUMN] = period;
    out[FILE_COLUMN] = 'Last generated report';
    return out;
  });
  if (!hasPeriod) columns.push({ name: PERIOD_COLUMN, type: 'text' });
  columns.push({ name: FILE_COLUMN, type: 'text' });
  return { columns, rows, sources: [{ name: 'Last generated report', rows: rows.length, skipped: 0, period }] };
}

// ---------------------------------------------------------------------------
// From saved report files
// ---------------------------------------------------------------------------

const MONEY_WORDS = /revenue|cost|profit|amount|pharmacy|incentive|fee|salary|issues|total|net|gross|price|sales/i;
const TOTAL_ROW = /^(grand\s+)?(sub)?total\b/i;

/** The file name without its extension, as the period of a file that has no Month column. */
export function periodFromFileName(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{2,5}$/, '').trim() || name;
}

function textOf(v: CellValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return toIsoDate(v) ?? '';
  return String(v).trim();
}

/** A Month cell as text: a real date becomes "Oct-2026". */
function periodCell(v: CellValue | undefined): string | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
  if (v instanceof Date) {
    const p = istDateParts(v);
    return p ? monthLabel(`${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}`) : null;
  }
  return String(v).trim();
}

export type ReadOutputOptions = {
  fileName: string;
  /** The linked recipe: its report columns give the types and its output says where the table is. */
  recipe?: Pick<Recipe, 'report' | 'output'> | null;
};

/** Reads one saved report file: finds the table, skips totals and blank rows, adds the file and period columns. */
export function readOutputFile(bytes: Uint8Array, opts: ReadOutputOptions): DashboardData {
  const wb = openWorkbook(bytes);
  const out = opts.recipe?.output;
  const wantedSheet = out?.mode === 'template' ? out.sheetName : out?.mode === 'plain' ? out.sheetName : undefined;
  const sheets = listSheets(wb);
  const sheet = (wantedSheet && sheets.find((s) => s.name.toLowerCase() === wantedSheet.toLowerCase())) || sheets.find((s) => s.rowCount > 0);
  const fail = (message: string): DashboardData => ({ columns: [], rows: [], sources: [{ name: opts.fileName, rows: 0, skipped: 0, period: periodFromFileName(opts.fileName), message }] });
  if (!sheet) return fail('The file has no data.');

  const { rows: raw } = readSheetRows(wb, sheet.name);
  const fixedRow = out?.mode === 'template' && typeof out.headerRow === 'number' ? out.headerRow : null;
  const headerRow = fixedRow ?? detectHeaderRow(raw);
  if (headerRow === null) return fail('No table with column headings was found in this file.');
  const header = headersAt(raw, headerRow);
  const names = header.headers;

  // columns: types from the recipe's report when linked, else guessed
  const known = new Map((opts.recipe?.report.columns ?? []).map((c) => [c.name.replace(/\s+/g, '').toLowerCase(), c] as const));
  const body = raw.slice(headerRow);
  const kept: { row: (typeof raw)[number] }[] = [];
  let skipped = 0;
  for (const row of body) {
    if (row.every(isBlankCell)) continue;
    const firstTexts = row.map(textOf).filter((t) => t !== '').slice(0, 3);
    const hasText = row.some((c) => typeof c === 'string' && c.trim() !== '');
    if (firstTexts.some((t) => TOTAL_ROW.test(t)) || !hasText) {
      skipped++; // a totals row, or a row of bare numbers (such as a sum line)
      continue;
    }
    kept.push({ row });
  }

  const columns: DashColumn[] = names.map((name, i) => {
    const rc = known.get(name.replace(/\s+/g, '').toLowerCase());
    if (rc && rc.kind !== 'serial') return { name, type: rc.kind === 'group' ? 'text' : rc.type };
    const values = kept.map((k) => k.row[i]).filter((v) => v !== null && v !== undefined && v !== '');
    if (values.length > 0 && values.every((v) => typeof v === 'number')) return { name, type: MONEY_WORDS.test(name) ? 'money' : 'number' };
    return { name, type: 'text' };
  });
  const serial = columns.findIndex((c) => /^s\.?\s*no\.?$/i.test(c.name));
  const periodAt = names.findIndex((n) => n.toUpperCase() === PERIOD_COLUMN.toUpperCase());
  const filePeriod = periodFromFileName(opts.fileName);

  const rows: DashRow[] = kept.map(({ row }) => {
    const r: DashRow = {};
    columns.forEach((c, i) => {
      if (i === serial) return;
      const v = row[i];
      if (c.name === names[periodAt]) r[c.name] = periodCell(v) ?? filePeriod;
      else if (c.type === 'money' || c.type === 'number') r[c.name] = typeof v === 'number' ? v : null;
      else r[c.name] = textOf(v) || null;
    });
    if (periodAt === -1) r[PERIOD_COLUMN] = filePeriod;
    r[FILE_COLUMN] = opts.fileName;
    return r;
  });

  const outCols = columns.filter((_, i) => i !== serial);
  if (periodAt === -1) outCols.push({ name: PERIOD_COLUMN, type: 'text' });
  outCols.push({ name: FILE_COLUMN, type: 'text' });
  const period = periodAt === -1 ? filePeriod : [...new Set(rows.map((r) => String(r[names[periodAt] as string] ?? '')))].join(', ');
  const message = rows.length === 0 ? 'The table has headings but no data rows. Is this the right file?' : undefined;
  return { columns: outCols, rows, sources: [{ name: opts.fileName, rows: rows.length, skipped, period, ...(message ? { message } : {}) }] };
}

/** Stacks several files. A column that is a number in one file and text in another is treated as text. */
export function stackData(parts: readonly DashboardData[]): DashboardData {
  const columns: DashColumn[] = [];
  for (const p of parts) {
    for (const c of p.columns) {
      const seen = columns.find((x) => x.name.toUpperCase() === c.name.toUpperCase());
      if (!seen) columns.push({ ...c });
      else if (seen.type !== c.type && c.type !== 'text' && (seen.type === 'money' || seen.type === 'number') && (c.type === 'money' || c.type === 'number')) seen.type = 'money';
      else if (seen.type !== c.type) seen.type = 'text';
    }
  }
  const rows = parts.flatMap((p) => p.rows.map((r) => Object.fromEntries(columns.map((c) => [c.name, r[c.name] ?? null])) as DashRow));
  return { columns, rows, sources: parts.flatMap((p) => p.sources) };
}

/** Columns a dashboard needs that the loaded data does not have. */
export function missingColumns(required: readonly string[], data: DashboardData): string[] {
  const have = new Set(data.columns.map((c) => c.name.toUpperCase()));
  return required.filter((c) => !have.has(c.toUpperCase()));
}
