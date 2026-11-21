// Group fact rows (and monthly costs) into pivot rows: one row per doctor,
// department, sponsor or month, with a column per measure.
//
// All sums are integer paise (or counts). Calculated measures (Total Revenue,
// Gross Profit) are computed here from the sums, never stored on fact rows.

import { normaliseLabel } from './doctors';
import { MEASURES, computeMeasure } from './measures';
import { COST_MEASURE_CODES, MEASURE_CODES, type CostEntry, type DoctorMaster, type FactRow, type MeasureCode } from './types';

export type PivotGroupBy = 'doctor' | 'department' | 'sponsor' | 'month';

/** Key of the group for facts whose doctor could not be matched. */
export const UNMATCHED_KEY = '__unmatched__';
/** Key of the group for facts with no department or sponsor. */
export const NONE_KEY = '__none__';

export type MeasureValues = Record<MeasureCode, number>;
export type PivotRow = { key: string; values: MeasureValues };

export type PivotOptions = {
  /** Monthly costs per doctor. Used for doctor, department and (with costMonth) month groups; sponsors have no costs. */
  costs?: readonly CostEntry[];
  /** Needed to move doctor costs into departments. */
  doctors?: readonly DoctorMaster[];
  /** The month the costs belong to (for groupBy 'month'). */
  costMonth?: string;
};

type Inputs = Partial<Record<MeasureCode, number>>;

function addTo(inputs: Inputs, code: MeasureCode, amount: number): void {
  const total = (inputs[code] ?? 0) + amount;
  if (!Number.isSafeInteger(total)) throw new TypeError(`Sum of ${code} is not a safe integer`);
  inputs[code] = total;
}

function factKey(fact: FactRow, groupBy: PivotGroupBy): string {
  switch (groupBy) {
    case 'doctor':
      return fact.doctorId ?? UNMATCHED_KEY;
    case 'department':
      return fact.departmentId ?? NONE_KEY;
    case 'sponsor':
      return fact.sponsor ?? NONE_KEY;
    case 'month':
      return fact.month;
  }
}

function costKey(entry: CostEntry, groupBy: PivotGroupBy, opts: PivotOptions): string | null {
  switch (groupBy) {
    case 'doctor':
      return entry.doctorId;
    case 'department': {
      const dept = opts.doctors?.find((d) => d.id === entry.doctorId)?.department;
      return dept ? normaliseLabel(dept) : NONE_KEY;
    }
    case 'month':
      return opts.costMonth ?? null;
    case 'sponsor':
      return null;
  }
}

function finish(inputs: Inputs): MeasureValues {
  return Object.fromEntries(MEASURE_CODES.map((code) => [code, computeMeasure(code, inputs)])) as MeasureValues;
}

/** One row per group, sorted by key (the unmatched / none group last). Calculated measures are filled in. */
export function pivot(facts: readonly FactRow[], groupBy: PivotGroupBy, opts: PivotOptions = {}): PivotRow[] {
  const groups = new Map<string, Inputs>();
  const bucket = (key: string): Inputs => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = {}));
    return g;
  };

  for (const f of facts) addTo(bucket(factKey(f, groupBy)), f.measure, f.amountPaise);

  for (const entry of opts.costs ?? []) {
    const key = costKey(entry, groupBy, opts);
    if (key === null) continue;
    const g = bucket(key);
    for (const code of COST_MEASURE_CODES) {
      const amount = entry.amounts[code];
      if (amount !== undefined) addTo(g, code, amount);
    }
  }

  // Named groups first; the "unmatched" and "none" groups last.
  const special = (key: string) => (key === UNMATCHED_KEY || key === NONE_KEY ? 1 : 0);
  return [...groups.entries()]
    .sort(([a], [b]) => special(a) - special(b) || a.localeCompare(b))
    .map(([key, inputs]) => ({ key, values: finish(inputs) }));
}

/** Sum of every measure over the rows (calculated measures are linear, so they add up too). */
export function totalValues(rows: readonly PivotRow[]): MeasureValues {
  const inputs: Inputs = {};
  for (const row of rows) {
    for (const def of MEASURES) if (def.kind !== 'calc') addTo(inputs, def.code, row.values[def.code]);
  }
  return finish(inputs);
}

/** Sum of the fact amounts per source measure (what the sources contributed). */
export function sumFacts(facts: readonly FactRow[]): Partial<Record<MeasureCode, number>> {
  const inputs: Inputs = {};
  for (const f of facts) addTo(inputs, f.measure, f.amountPaise);
  return inputs;
}
