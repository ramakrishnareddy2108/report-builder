// Compare a filled report (made by hand or by an earlier tool) with the tool's own,
// per row and per column, and show the differences as a readable table.

import type ExcelJS from 'exceljs';
import { normaliseName } from '@/core/doctors';
import { MEASURES, measuresFor, type ReportKind } from '@/core/measures';
import { formatINR, toPaise } from '@/core/money';
import type { ReportRow } from '@/core/report';
import type { MeasureCode } from '@/core/types';
import { loadTemplate } from '@/excel/templates';

export type ExpectedRow = { name: string; values: Partial<Record<MeasureCode, number>> };

export type Difference = { name: string; column: string; expected: number; actual: number; diff: number };

export type Comparison = {
  differences: Difference[];
  /** Names in the expected report that the tool has no row for. */
  onlyExpected: string[];
  /** Names the tool has a row for that the expected report lacks. */
  onlyActual: string[];
  rowsCompared: number;
};

/** A cell as paise (money) or as a plain count; null when blank or unreadable. */
function numberOf(cell: ExcelJS.Cell, kind: 'money' | 'count' | 'calc'): number | null {
  const v = cell.value;
  const raw = v !== null && typeof v === 'object' && 'result' in v ? v.result : v;
  if (kind === 'count') return typeof raw === 'number' ? raw : null;
  return typeof raw === 'number' || typeof raw === 'string' ? toPaise(raw) : null;
}

/** The rows of a filled report workbook, or null when it holds no data rows (an empty template). */
export async function readExpectedReport(bytes: ArrayBuffer | Uint8Array, kind: ReportKind): Promise<ExpectedRow[] | null> {
  const table = await loadTemplate(bytes, kind);
  const nameCol = table.columns.get(kind === 'drr' ? 'Doctor Name' : 'Sponsor Name') as number;
  const rows: ExpectedRow[] = [];
  for (let r = table.firstDataRow; r <= table.sheet.rowCount; r++) {
    const line = table.sheet.getRow(r);
    const raw = line.getCell(nameCol).value;
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (name === '') continue;
    const values: ExpectedRow['values'] = {};
    for (const m of measuresFor(kind)) {
      const col = table.columns.get(kind === 'drr' ? m.drrHeader : (m.sponsorHeader as string));
      const value = col === undefined ? null : numberOf(line.getCell(col), m.kind);
      if (value !== null) values[m.code] = value;
    }
    rows.push({ name, values });
  }
  return rows.length > 0 ? rows : null;
}

const keyOf = (name: string) => normaliseName(name).key;

/** Compare every measure of every row, ignoring case and spelling of the names. Money differences within `tolerancePaise` are ignored; counts must match exactly. */
export function compareReports(expected: readonly ExpectedRow[], actual: readonly ReportRow[], tolerancePaise = 100): Comparison {
  const actualByKey = new Map(actual.map((r) => [keyOf(r.name), r]));
  const expectedKeys = new Set(expected.map((e) => keyOf(e.name)));
  const result: Comparison = { differences: [], onlyExpected: [], onlyActual: [], rowsCompared: 0 };

  for (const e of expected) {
    const a = actualByKey.get(keyOf(e.name));
    if (!a) {
      result.onlyExpected.push(e.name);
      continue;
    }
    result.rowsCompared++;
    for (const m of MEASURES) {
      const want = e.values[m.code];
      if (want === undefined) continue;
      const got = a.values[m.code];
      // Money may differ by the tolerance; a count must match exactly.
      if (Math.abs(want - got) > (m.kind === 'count' ? 0 : tolerancePaise)) {
        result.differences.push({ name: e.name, column: m.label, expected: want, actual: got, diff: got - want });
      }
    }
  }
  for (const a of actual) if (!expectedKeys.has(keyOf(a.name))) result.onlyActual.push(a.name);
  return result;
}

/** A plain-text table: row, column, expected, actual, diff. */
export function formatDifferences(c: Comparison): string {
  const money = (p: number, count: boolean) => (count ? String(p) : formatINR(p));
  const countColumns = new Set(MEASURES.filter((m) => m.kind === 'count').map((m) => m.label));
  const lines = c.differences.map((d) => {
    const count = countColumns.has(d.column);
    return [d.name, d.column, money(d.expected, count), money(d.actual, count), money(d.diff, count)];
  });
  const head = ['Name', 'Column', 'Expected', 'Actual', 'Diff'];
  const widths = head.map((h, i) => Math.max(h.length, ...lines.map((l) => (l[i] as string).length)));
  const fmt = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i] as number)).join('  ');
  return [
    fmt(head),
    widths.map((w) => '-'.repeat(w)).join('  '),
    ...lines.map(fmt),
    ...(c.onlyExpected.length ? [`Only in the expected report: ${c.onlyExpected.join(', ')}`] : []),
    ...(c.onlyActual.length ? [`Only in the tool's report: ${c.onlyActual.join(', ')}`] : []),
  ].join('\n');
}
