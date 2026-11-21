// Pipeline step 7: lookups, in order.
//
// A lookup fills a column on the rows of one source (the target, e.g. OP Pharmacy) from the rows of another source
// (e.g. OP Consultations) that share a key (e.g. UMRNO).
//
//   pick 'latestOnOrBefore'  the latest record dated on or before the target row's date  → Matched
//                            only later records exist → the nearest later one            → Fallback
//   pick 'first'             the first record in file order                              → Matched
//   pick 'single'            the record when all records agree                           → Matched
//                            records disagree → the first one                            → Fallback
//   nothing found            the rule's notFoundValue (also for every extra value)        → Unattributed
//
// Dates are compared as calendar dates (ISO text), so the time zone never matters. `onlyWhen` limits which target
// rows are looked at. The status goes to `writeStatusColumn` (a new text column) when the rule names one.

import { compileFormula, describeFormulaError, toBool, type FormulaParams } from '@/formula';
import type { LookupRule, Recipe } from '@/recipe/schema';
import { makeRowContext } from './rowContext';
import { SOURCE_COLUMN, type CombinedRow, type CombinedTable, type Issue, type ParamValues, type Typed } from './types';

export type LookupStatus = 'Matched' | 'Fallback' | 'Unattributed';

export type LookupResult = {
  label: string;
  /** Target rows the rule looked at (after onlyWhen). */
  considered: number;
  /** Target rows skipped because onlyWhen was false. */
  skipped: number;
  byStatus: Record<LookupStatus, number>;
  /** Paise per status of the target's main money column (Amount when it has one), or null if it has none. */
  amountColumn: string | null;
  amountByStatus: Record<LookupStatus, number>;
  /** Examples of keys that were not found (never a patient name: only the key column, e.g. UMRNO). */
  notFoundKeys: string[];
  /** Target rows whose key was blank. */
  blankKeyRows: number;
};

export type LookupsOutput = { results: LookupResult[]; issues: Issue[] };

type Candidate = { date: string | null; value: Typed; extras: Typed[]; order: number };

const keyOf = (v: Typed): string | null => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().toUpperCase());

function pickCandidate(rule: LookupRule, list: Candidate[], targetDate: string | null): { c: Candidate; status: LookupStatus } | null {
  if (list.length === 0) return null;
  switch (rule.pick) {
    case 'first':
      return { c: list[0] as Candidate, status: 'Matched' };
    case 'single': {
      const first = list[0] as Candidate;
      const agree = list.every((c) => c.value === first.value && c.extras.every((e, i) => e === first.extras[i]));
      return { c: first, status: agree ? 'Matched' : 'Fallback' };
    }
    case 'latestOnOrBefore': {
      if (targetDate === null) {
        // Without a date there is no "before": use the latest record and say so.
        const dated = [...list].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.order - b.order);
        return { c: dated[dated.length - 1] as Candidate, status: 'Fallback' };
      }
      let before: Candidate | null = null;
      let after: Candidate | null = null;
      for (const c of list) {
        if (c.date !== null && c.date <= targetDate) {
          if (before === null || c.date > (before.date as string) || (c.date === before.date && c.order > before.order)) before = c;
        } else if (c.date !== null) {
          if (after === null || c.date < (after.date as string) || (c.date === after.date && c.order < after.order)) after = c;
        }
      }
      if (before) return { c: before, status: 'Matched' };
      if (after) return { c: after, status: 'Fallback' };
      return { c: list[0] as Candidate, status: 'Fallback' }; // records without dates
    }
  }
}

export function runLookups(
  table: CombinedTable,
  rules: readonly LookupRule[],
  recipe: Pick<Recipe, 'sources'>,
  params: FormulaParams | ParamValues = {},
): LookupsOutput {
  const results: LookupResult[] = [];
  const issues: Issue[] = [];
  const colName = (name: string) => table.columns.find((c) => c.name.toUpperCase() === name.toUpperCase())?.name ?? null;
  const labelOf = (id: string) => recipe.sources.find((s) => s.id === id)?.label ?? null;

  for (const rule of rules) {
    const fail = (message: string, column?: string) => issues.push({ level: 'error', message: `Lookup “${rule.label}”: ${message}`, ...(column ? { column } : {}) });

    const targetLabel = labelOf(rule.target.source);
    const fromLabel = labelOf(rule.from.source);
    if (!targetLabel) { fail(`the target source “${rule.target.source}” is not in this recipe. Fix it in Prepare.`); continue; }
    if (!fromLabel) { fail(`the lookup source “${rule.from.source}” is not in this recipe. Fix it in Prepare.`); continue; }

    const targetKey = colName(rule.target.key);
    const fromKey = colName(rule.from.key);
    const fromValue = colName(rule.from.value);
    const targetDate = rule.target.date ? colName(rule.target.date) : null;
    const fromDate = rule.from.date ? colName(rule.from.date) : null;
    const extraFrom = (rule.from.extraValues ?? []).map((e) => ({ from: colName(e.from), as: e.as }));

    const missing = [
      [rule.target.key, targetKey], [rule.from.key, fromKey], [rule.from.value, fromValue],
      ...(rule.target.date ? [[rule.target.date, targetDate]] : []),
      ...(rule.from.date ? [[rule.from.date, fromDate]] : []),
      ...(rule.from.extraValues ?? []).map((e, i) => [e.from, extraFrom[i]?.from ?? null]),
    ].filter(([, found]) => found === null) as [string, null][];
    if (missing.length > 0) {
      for (const [name] of missing) fail(`column ${name} was not found in the combined data. Pick the new column in Prepare.`, name);
      continue;
    }
    if (rule.pick === 'latestOnOrBefore' && (!targetDate || !fromDate)) {
      fail('picking the latest record on or before a date needs a date column on both sides. Set them in Prepare.');
      continue;
    }

    // make sure the columns written to exist
    const ensure = (name: string, type: 'text' | 'number' | 'money' | 'date') => {
      if (!colName(name)) table.columns.push({ name, type });
      for (const r of table.rows) if (!(name in r)) r[name] = null;
    };
    const written = colName(rule.target.column) ?? rule.target.column;
    ensure(written, table.columns.find((c) => c.name === fromValue)?.type ?? 'text');
    for (const e of extraFrom) ensure(colName(e.as) ?? e.as, table.columns.find((c) => c.name === e.from)?.type ?? 'text');
    if (rule.writeStatusColumn) ensure(rule.writeStatusColumn, 'text');
    const statusColumn = rule.writeStatusColumn ? (colName(rule.writeStatusColumn) as string) : null;

    // index the lookup source by key
    const index = new Map<string, Candidate[]>();
    table.rows.forEach((row, order) => {
      if (row[SOURCE_COLUMN] !== fromLabel) return;
      const k = keyOf(row[fromKey as string] as Typed);
      if (k === null) return;
      const cand: Candidate = {
        date: fromDate ? ((row[fromDate] as string | null) ?? null) : null,
        value: row[fromValue as string] as Typed,
        extras: extraFrom.map((e) => row[e.from as string] as Typed),
        order,
      };
      const list = index.get(k);
      if (list) list.push(cand);
      else index.set(k, [cand]);
    });

    let onlyWhen: ((row: CombinedRow) => boolean) | null = null;
    if (rule.onlyWhen) {
      let compiled;
      try {
        compiled = compileFormula(rule.onlyWhen);
      } catch (err) {
        fail(`the “only when” formula is not valid: ${describeFormulaError(err)}`);
        continue;
      }
      const unknown = compiled.columns.filter((c) => colName(c) === null);
      if (unknown.length > 0) {
        for (const c of unknown) fail(`the “only when” formula uses [${c}], but column ${c} was not found. Pick the new column in Prepare.`, c);
        continue;
      }
      const ctxOf = makeRowContext(table.columns, params as FormulaParams);
      const formula = compiled;
      onlyWhen = (row) => toBool(formula.evaluate(ctxOf(row)));
    }

    // the target's main money column, for the amounts in the Checks
    const moneyCols = table.columns.filter((c) => c.type === 'money').map((c) => c.name);
    const amountColumn = moneyCols.find((n) => n.toUpperCase() === 'AMOUNT') ?? moneyCols.find((n) => table.rows.some((r) => r[SOURCE_COLUMN] === targetLabel && typeof r[n] === 'number')) ?? null;

    const result: LookupResult = {
      label: rule.label,
      considered: 0,
      skipped: 0,
      byStatus: { Matched: 0, Fallback: 0, Unattributed: 0 },
      amountColumn,
      amountByStatus: { Matched: 0, Fallback: 0, Unattributed: 0 },
      notFoundKeys: [],
      blankKeyRows: 0,
    };

    for (const row of table.rows) {
      if (row[SOURCE_COLUMN] !== targetLabel) continue;
      if (onlyWhen) {
        let applies = false;
        try {
          applies = onlyWhen(row);
        } catch {
          applies = false;
        }
        if (!applies) {
          result.skipped++;
          continue;
        }
      }
      result.considered++;
      const key = keyOf(row[targetKey as string] as Typed);
      if (key === null) result.blankKeyRows++;
      const date = targetDate ? ((row[targetDate] as string | null) ?? null) : null;
      const hit = key === null ? null : pickCandidate(rule, index.get(key) ?? [], date);

      let status: LookupStatus;
      if (hit) {
        row[written] = hit.c.value;
        extraFrom.forEach((e, i) => { row[colName(e.as) ?? e.as] = hit.c.extras[i] ?? null; });
        status = hit.status;
      } else {
        row[written] = rule.notFoundValue;
        for (const e of extraFrom) row[colName(e.as) ?? e.as] = rule.notFoundValue;
        status = 'Unattributed';
        if (key !== null && result.notFoundKeys.length < 10 && !result.notFoundKeys.includes(String(row[targetKey as string]))) {
          result.notFoundKeys.push(String(row[targetKey as string]));
        }
      }
      if (statusColumn) row[statusColumn] = status;
      result.byStatus[status]++;
      const amount = amountColumn ? row[amountColumn] : null;
      if (typeof amount === 'number') result.amountByStatus[status] += amount;
    }
    results.push(result);
  }
  return { results, issues };
}
