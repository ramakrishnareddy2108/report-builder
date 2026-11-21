// Monthly costs per doctor: Departmental Issues, Salary, Incentives, Professional Fee.
// Amounts are integer paise. A blank cell means "not entered" (it counts as 0 in the report).

import type { Row } from '@/excel/readWorkbook';
import { DoctorMatcher } from './doctors';
import { parseMoney } from './money';
import { COST_MEASURE_CODES, type CostEntry, type CostMeasureCode, type DoctorMaster } from './types';

export type CostAmounts = Partial<Record<CostMeasureCode, number>>;

/** One row of the costs grid: a doctor and what was entered for them. */
export type CostRow = { doctorId: string; amounts: CostAmounts; note: string };

// ---------------------------------------------------------------------------
// Rows <-> saved entries
// ---------------------------------------------------------------------------

/** One row per doctor in the master (in that order), filled from the saved entries. */
export function costRows(doctors: readonly DoctorMaster[], entries: readonly CostEntry[]): CostRow[] {
  const byDoctor = new Map(entries.map((e) => [e.doctorId, e]));
  return doctors.map((d) => ({ doctorId: d.id, amounts: { ...byDoctor.get(d.id)?.amounts }, note: byDoctor.get(d.id)?.note ?? '' }));
}

/** Saved entries for doctors that are no longer in the master. They are kept, not dropped. */
export function orphanEntries(doctors: readonly DoctorMaster[], entries: readonly CostEntry[]): CostEntry[] {
  const known = new Set(doctors.map((d) => d.id));
  return entries.filter((e) => !known.has(e.doctorId));
}

/** True when any cost amount is entered (an entered 0 counts). */
export function hasAmounts(amounts: CostAmounts): boolean {
  return COST_MEASURE_CODES.some((c) => amounts[c] !== undefined);
}

/** Entries to save: rows with an amount or a note, plus the orphans. */
export function toEntries(rows: readonly CostRow[], orphans: readonly CostEntry[] = []): CostEntry[] {
  const entries = rows
    .filter((r) => hasAmounts(r.amounts) || r.note.trim() !== '')
    .map((r): CostEntry => ({ doctorId: r.doctorId, amounts: { ...r.amounts }, ...(r.note.trim() ? { note: r.note.trim() } : {}) }));
  return [...entries, ...orphans];
}

/** Total of each cost column over the rows (integer paise). */
export function costTotals(rows: readonly CostRow[]): Record<CostMeasureCode, number> {
  const totals = Object.fromEntries(COST_MEASURE_CODES.map((c) => [c, 0])) as Record<CostMeasureCode, number>;
  for (const row of rows) {
    for (const code of COST_MEASURE_CODES) {
      totals[code] += row.amounts[code] ?? 0;
      if (!Number.isSafeInteger(totals[code])) throw new TypeError(`Total of ${code} is too large`);
    }
  }
  return totals;
}

/** True when any row has an amount. */
export function anyAmounts(rows: readonly CostRow[]): boolean {
  return rows.some((r) => hasAmounts(r.amounts));
}

// ---------------------------------------------------------------------------
// Typing an amount
// ---------------------------------------------------------------------------

export type CostInput = { ok: true; paise: number | null } | { ok: false; message: string };

/** Largest amount accepted in one cell: Rs 100 crore, far above any real doctor cost. */
export const MAX_COST_PAISE = 1_000_000_000 * 100;

/** Text typed in a cell -> paise. Blank means "not entered" (null). */
export function parseCostInput(text: string): CostInput {
  const r = parseMoney(text);
  if (!r.ok) {
    return r.reason === 'blank'
      ? { ok: true, paise: null }
      : { ok: false, message: `“${text.trim()}” is not an amount. Type rupees, for example 12500 or 12,500.50.` };
  }
  if (Math.abs(r.paise) > MAX_COST_PAISE) return { ok: false, message: 'That amount is too large to be right.' };
  return { ok: true, paise: r.paise };
}

// ---------------------------------------------------------------------------
// Importing from Excel
// ---------------------------------------------------------------------------

export type CostImportMapping = {
  /** 1-based Excel row of the header. */
  headerRow: number;
  /** 0-based column of the doctor name. */
  doctorColumn: number;
  /** 0-based column of each cost; a cost with no column is left as it is. */
  columns: Partial<Record<CostMeasureCode, number>>;
};

export type CostImportResult = {
  /** Amounts per doctor id, for the costs that were mapped and readable. */
  amounts: Map<string, CostAmounts>;
  /** Doctor names that match nobody in the master (never created). */
  unmatched: { raw: string; row: number }[];
  /** A doctor listed on more than one row; none of those rows is applied. */
  duplicates: { doctorId: string; rows: number[] }[];
  /** Amounts that could not be read; they are not applied. */
  badCells: { row: number; cost: CostMeasureCode; raw: string }[];
  /** Rows with no doctor name (blank or spacer rows). */
  blankRows: number;
  /** Data rows looked at. */
  rowsRead: number;
};

const cellText = (v: Row[number] | undefined): string => (v === null || v === undefined ? '' : String(v).trim());

export function mapCostImport(
  rows: readonly Row[],
  mapping: CostImportMapping,
  doctors: readonly DoctorMaster[],
): CostImportResult {
  const matcher = new DoctorMatcher(doctors);
  const result: CostImportResult = { amounts: new Map(), unmatched: [], duplicates: [], badCells: [], blankRows: 0, rowsRead: 0 };
  const seenRows = new Map<string, number[]>();
  const perDoctor = new Map<string, CostAmounts>();

  for (let r = mapping.headerRow; r < rows.length; r++) {
    const row = rows[r] as Row;
    const excelRow = r + 1;
    result.rowsRead++;
    const raw = cellText(row[mapping.doctorColumn]);
    if (raw === '') {
      result.blankRows++;
      continue;
    }
    const match = matcher.match(raw);
    if (match.status !== 'matched') {
      result.unmatched.push({ raw, row: excelRow });
      continue;
    }
    const id = match.doctor.id;
    seenRows.set(id, [...(seenRows.get(id) ?? []), excelRow]);

    const amounts: CostAmounts = {};
    for (const code of COST_MEASURE_CODES) {
      const col = mapping.columns[code];
      if (col === undefined) continue;
      const cell = row[col];
      const parsed = parseMoney(cell ?? null);
      if (parsed.ok) amounts[code] = parsed.paise;
      else if (parsed.reason === 'invalid') result.badCells.push({ row: excelRow, cost: code, raw: cellText(cell).slice(0, 40) });
    }
    perDoctor.set(id, amounts);
  }

  for (const [doctorId, list] of seenRows) {
    if (list.length > 1) result.duplicates.push({ doctorId, rows: list });
    else result.amounts.set(doctorId, perDoctor.get(doctorId) as CostAmounts);
  }
  return result;
}

/** Put imported amounts into the rows: only the imported costs change, a doctor not in the file is untouched. */
export function applyImport(rows: readonly CostRow[], imported: ReadonlyMap<string, CostAmounts>): CostRow[] {
  return rows.map((r) => {
    const incoming = imported.get(r.doctorId);
    return incoming ? { ...r, amounts: { ...r.amounts, ...incoming } } : r;
  });
}

const COLUMN_HINTS: Readonly<Record<CostMeasureCode, RegExp>> = {
  DEPT_ISSUES: /issue|departmental/i,
  SALARY: /salary/i,
  INCENTIVES: /incentive/i,
  PROF_FEE: /prof|fee/i,
};

/** Guess which column is the doctor and which hold the costs, from the header text. The user confirms. */
export function suggestImportColumns(headers: readonly string[]): { doctorColumn: number | null; columns: CostImportMapping['columns'] } {
  const find = (re: RegExp, skip: ReadonlySet<number> = new Set()): number | null => {
    const i = headers.findIndex((h, idx) => !skip.has(idx) && re.test(h));
    return i === -1 ? null : i;
  };
  const columns: CostImportMapping['columns'] = {};
  const used = new Set<number>();
  for (const code of COST_MEASURE_CODES) {
    const i = find(COLUMN_HINTS[code], used);
    if (i !== null) {
      columns[code] = i;
      used.add(i);
    }
  }
  return { doctorColumn: find(/doctor|consultant|name/i, used), columns };
}

/** Change one doctor's amounts or note. An entry left with nothing in it is removed. Returns a new list. */
export function setEntry(
  entries: readonly CostEntry[],
  doctorId: string,
  patch: { amounts?: CostAmounts; note?: string },
): CostEntry[] {
  const current = entries.find((e) => e.doctorId === doctorId);
  const amounts = patch.amounts ?? current?.amounts ?? {};
  const note = (patch.note ?? current?.note ?? '').trim();
  const next: CostEntry | null = hasAmounts(amounts) || note !== '' ? { doctorId, amounts, ...(note ? { note } : {}) } : null;
  const rest = entries.filter((e) => e.doctorId !== doctorId);
  if (!next) return rest;
  return current ? entries.map((e) => (e.doctorId === doctorId ? next : e)) : [...rest, next];
}
