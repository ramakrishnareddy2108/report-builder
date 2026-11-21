// A saved month as data to compare: rows per doctor, department and sponsor,
// with the same measures as the reports. Built from a run's facts and costs,
// or from an imported past DRR (a summary month with no fact rows).

import { NONE_KEY, pivot, totalValues, type MeasureValues } from './aggregate';
import { MEASURES, computeMeasure } from './measures';
import { normaliseLabel, normaliseName } from './doctors';
import { doctorReport } from './report';
import type { SummaryFile } from './schemas';
import type { CheckResult, CostEntry, DoctorMaster, FactRow, MeasureCode, RunKind, RunStatus } from './types';

export const GROUP_LEVELS = ['doctor', 'department', 'sponsor'] as const;
export type GroupLevel = (typeof GROUP_LEVELS)[number];

export const LEVEL_LABELS: Readonly<Record<GroupLevel, string>> = {
  doctor: 'Doctor',
  department: 'Department',
  sponsor: 'Sponsor',
};

export type GroupRow = {
  /** Same for the same doctor, department or sponsor in every month (names are normalised). */
  key: string;
  name: string;
  /** Doctor rows: the doctor's department as in the report ('' for others). */
  department?: string;
  values: MeasureValues;
};

export type MonthData = {
  month: string;
  runNumber: number;
  status: RunStatus;
  kind: RunKind;
  levels: Record<GroupLevel, GroupRow[]>;
  totals: MeasureValues;
  /** null for a summary month, which has no checks. */
  checks: { fail: number; warning: number } | null;
};

/** The key a doctor has in every month: their normalised name, so spellings and ids do not matter. */
export const doctorKey = (name: string): string => normaliseName(name).key || name;

const NO_DEPARTMENT = '(No department)';

/** Doctor rows from a list of named rows, made unique by key (a clash adds up, it never drops a row). */
function mergeByKey(rows: readonly GroupRow[]): GroupRow[] {
  const merged = new Map<string, GroupRow>();
  for (const row of rows) {
    const existing = merged.get(row.key);
    if (!existing) {
      merged.set(row.key, { ...row, values: { ...row.values } });
      continue;
    }
    for (const m of MEASURES) {
      if (m.kind !== 'calc') existing.values[m.code] += row.values[m.code];
    }
    existing.values = recalc(existing.values);
  }
  return [...merged.values()];
}

/** Fill the calculated measures from the others. */
function recalc(values: MeasureValues): MeasureValues {
  const inputs: Partial<Record<MeasureCode, number>> = {};
  for (const m of MEASURES) if (m.kind !== 'calc') inputs[m.code] = values[m.code];
  return Object.fromEntries(MEASURES.map((m) => [m.code, computeMeasure(m.code, inputs)])) as MeasureValues;
}

function withTotals(partial: Omit<MonthData, 'totals'>): MonthData {
  return { ...partial, totals: totalValues(partial.levels.doctor) };
}

export type RunMonthInput = {
  month: string;
  runNumber: number;
  status: RunStatus;
  facts: readonly FactRow[];
  costs: readonly CostEntry[];
  doctors: readonly DoctorMaster[];
  checks: readonly CheckResult[];
};

/** A month from a saved run: pivots of its facts and costs. */
export function monthDataFromRun(input: RunMonthInput): MonthData {
  const { month, facts, costs, doctors } = input;
  const known = new Set(doctors.map((d) => d.id));
  const knownCosts = costs.filter((c) => known.has(c.doctorId));

  const doctorRows = doctorReport(facts, costs, doctors, month).map((r) => ({ key: doctorKey(r.name), name: r.name, department: r.department, values: r.values }));
  const departmentRows = pivot(facts, 'department', { costs: knownCosts, doctors }).map((r) => ({
    key: r.key,
    name: r.key === NONE_KEY ? NO_DEPARTMENT : r.key,
    values: r.values,
  }));
  const sponsorRows = pivot(facts, 'sponsor').map((r) => ({ key: r.key, name: r.key === NONE_KEY ? '(No sponsor)' : r.key, values: r.values }));

  return withTotals({
    month,
    runNumber: input.runNumber,
    status: input.status,
    kind: 'run',
    levels: { doctor: mergeByKey(doctorRows), department: departmentRows, sponsor: sponsorRows },
    checks: {
      fail: input.checks.filter((c) => c.level === 'Fail').length,
      warning: input.checks.filter((c) => c.level === 'Warning').length,
    },
  });
}

/** A month from an imported DRR: its doctor rows, with departments grouped from the rows. No sponsor data. */
export function monthDataFromSummary(info: { runNumber: number; status: RunStatus }, summary: SummaryFile): MonthData {
  const doctorRows: GroupRow[] = summary.rows.map((r) => {
    const inputs: Partial<Record<MeasureCode, number>> = {};
    for (const m of MEASURES) if (m.kind !== 'calc') inputs[m.code] = r.values[m.code] ?? 0;
    return {
      key: doctorKey(r.name),
      name: r.name,
      department: r.department,
      values: Object.fromEntries(MEASURES.map((m) => [m.code, computeMeasure(m.code, inputs)])) as MeasureValues,
    };
  });
  const byDepartment = new Map<string, GroupRow[]>();
  summary.rows.forEach((r, i) => {
    const key = r.department.trim() === '' ? NONE_KEY : normaliseLabel(r.department);
    byDepartment.set(key, [...(byDepartment.get(key) ?? []), { key, name: key === NONE_KEY ? NO_DEPARTMENT : key, values: (doctorRows[i] as GroupRow).values }]);
  });
  const departmentRows = [...byDepartment.entries()].map(([key, rows]) => ({ ...(mergeByKey(rows)[0] as GroupRow), key }));

  return withTotals({
    month: summary.month,
    runNumber: info.runNumber,
    status: info.status,
    kind: 'summary',
    levels: { doctor: mergeByKey(doctorRows), department: departmentRows, sponsor: [] },
    checks: null,
  });
}

// ---------------------------------------------------------------------------
// Compare two months
// ---------------------------------------------------------------------------

export type CompareRow = {
  key: string;
  name: string;
  /** null when the row is not in that month. */
  a: MeasureValues | null;
  b: MeasureValues | null;
};

/** Rows of both months joined by key; a row in only one month has null for the other. */
export function compareMonths(a: readonly GroupRow[], b: readonly GroupRow[]): CompareRow[] {
  const rows = new Map<string, CompareRow>();
  for (const r of b) rows.set(r.key, { key: r.key, name: r.name, a: null, b: r.values });
  for (const r of a) {
    const existing = rows.get(r.key);
    if (existing) existing.a = r.values;
    else rows.set(r.key, { key: r.key, name: r.name, a: r.values, b: null });
  }
  return [...rows.values()].sort((x, y) => x.name.localeCompare(y.name, 'en', { sensitivity: 'base' }));
}

/** A minus B (integer paise or a count). A missing month counts as 0. */
export function change(row: Pick<CompareRow, 'a' | 'b'>, code: MeasureCode): number {
  return (row.a?.[code] ?? 0) - (row.b?.[code] ?? 0);
}

/** The change as a percent of B; null when B is 0 (a new row has no percent). */
export function changePercent(row: Pick<CompareRow, 'a' | 'b'>, code: MeasureCode): number | null {
  const b = row.b?.[code] ?? 0;
  return b === 0 ? null : (change(row, code) / Math.abs(b)) * 100;
}

export type Mover = { key: string; name: string; change: number; percent: number | null };

/** The biggest increases and decreases of a measure, by amount. */
export function topMovers(rows: readonly CompareRow[], code: MeasureCode, n = 10): { risers: Mover[]; fallers: Mover[] } {
  const moves: Mover[] = rows
    .map((r) => ({ key: r.key, name: r.name, change: change(r, code), percent: changePercent(r, code) }))
    .filter((m) => m.change !== 0);
  return {
    risers: moves.filter((m) => m.change > 0).sort((x, y) => y.change - x.change).slice(0, n),
    fallers: moves.filter((m) => m.change < 0).sort((x, y) => x.change - y.change).slice(0, n),
  };
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

export type TrendLevel = 'overall' | GroupLevel;

export type Trend = {
  /** Oldest first. */
  months: string[];
  /** One line per series; null where a month has no value (not in that month's data). */
  series: { name: string; points: (number | null)[] }[];
};

/**
 * A measure over months. `overall` is one line; the other levels give a line per doctor,
 * department or sponsor, limited to the `topN` with the largest values across the months.
 */
export function trend(data: readonly MonthData[], level: TrendLevel, code: MeasureCode, topN = 8): Trend {
  const sorted = [...data].sort((a, b) => a.month.localeCompare(b.month));
  const months = sorted.map((d) => d.month);
  if (level === 'overall') return { months, series: [{ name: 'All', points: sorted.map((d) => d.totals[code]) }] };

  const names = new Map<string, string>();
  const weight = new Map<string, number>();
  const perMonth = sorted.map((d) => {
    const m = new Map<string, number>();
    for (const row of d.levels[level]) {
      m.set(row.key, row.values[code]);
      names.set(row.key, row.name);
      weight.set(row.key, (weight.get(row.key) ?? 0) + Math.abs(row.values[code]));
    }
    return m;
  });
  const top = [...weight.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([key]) => key);
  return {
    months,
    series: top.map((key) => ({ name: names.get(key) as string, points: perMonth.map((m) => m.get(key) ?? null) })),
  };
}
