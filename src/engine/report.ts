// Pipeline step 8: group, aggregate, formula columns, serial, sort, totals.
//
//  - Rows are grouped with a Map (one pass over the combined table).
//  - Each aggregate column's `where` formula is evaluated once per combined row.
//  - Money is summed as integer paise. Formula columns see rupees and their money results go back to paise.
//  - Formula columns work on the same report row, in dependency order (a formula may use another formula column).
//  - The totals row is built from ALL rows with the same aggregates (so SUM, COUNT, COUNTDISTINCT, AVG, MIN and MAX
//    are all right), and its formula columns are recomputed on the totals.

import { toPaise } from '@/core/money';
import { convertValue } from '@/excel/convert';
import { compileFormula, describeFormulaError, FormulaError, toBool, type CompiledFormula, type FormulaParams, type Value } from '@/formula';
import type { CellValue } from '@/excel/readWorkbook';
import type { ColumnType, ReportColumn, ReportDef } from '@/recipe/schema';
import { makeRowContext } from './rowContext';
import type { CombinedRow, CombinedTable, Issue, Typed } from './types';

export type ReportColumnInfo = { name: string; type: ColumnType; kind: ReportColumn['kind'] };
export type ReportRow = Record<string, Typed>;

export type ReportResult = {
  columns: ReportColumnInfo[];
  rows: ReportRow[];
  /** The totals row, or null when the report has none. */
  totals: ReportRow | null;
  issues: Issue[];
  /** Combined rows counted into the report (all of them: nothing is dropped between combined and report). */
  inputRows: number;
};

type AggColumn = Extract<ReportColumn, { kind: 'aggregate' }>;
type FormulaColumn = Extract<ReportColumn, { kind: 'formula' }>;

type Acc = { rows: number; n: number; sum: number; min: Typed; max: Typed; distinct: Set<string> | null };
const newAcc = (distinct: boolean): Acc => ({ rows: 0, n: 0, sum: 0, min: null, max: null, distinct: distinct ? new Set() : null });

const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

function compare(a: Typed, b: Typed): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // blanks last
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
}

/** Rounds half away from zero. */
const roundAway = (n: number) => Math.sign(n) * Math.round(Math.abs(n));

function finish(agg: AggColumn, acc: Acc, sourceType: ColumnType | null): Typed {
  let v: Typed;
  let from: ColumnType = sourceType ?? 'number';
  switch (agg.agg) {
    case 'SUM':
      v = from === 'money' ? acc.sum : Number(acc.sum.toPrecision(15));
      break;
    case 'COUNT':
      v = agg.of ? acc.n : acc.rows;
      from = 'number';
      break;
    case 'COUNTDISTINCT':
      v = acc.distinct?.size ?? 0;
      from = 'number';
      break;
    case 'AVG':
      v = acc.n === 0 ? null : from === 'money' ? roundAway(acc.sum / acc.n) : Number((acc.sum / acc.n).toPrecision(15));
      break;
    case 'MIN':
      v = acc.min;
      break;
    case 'MAX':
      v = acc.max;
      break;
  }
  if (v === null || typeof v !== 'number') return v;
  // The column's declared type decides how the number is stored.
  if (from === 'money' && agg.type !== 'money') return v / 100;
  if (from !== 'money' && agg.type === 'money' && agg.agg !== 'COUNT' && agg.agg !== 'COUNTDISTINCT') return toPaise(v);
  return v;
}

export function buildReport(table: CombinedTable, def: ReportDef, params: FormulaParams = {}): ReportResult {
  const issues: Issue[] = [];
  const fail = (message: string, column?: string) => issues.push({ level: 'error', message: `Report: ${message}`, ...(column ? { column } : {}) });
  const empty = (): ReportResult => ({ columns: [], rows: [], totals: null, issues, inputRows: table.rows.length });

  const tableCol = (name: string) => table.columns.find((c) => same(c.name, name)) ?? null;
  const columns: ReportColumnInfo[] = def.columns.map((c) => ({ name: c.name, type: c.kind === 'serial' ? 'number' : c.kind === 'group' ? (tableCol(c.from)?.type ?? 'text') : c.type, kind: c.kind }));

  // --- validate the definition ---------------------------------------------------------------
  const seenNames = new Set<string>();
  for (const c of def.columns) {
    if (seenNames.has(c.name.toUpperCase())) fail(`two report columns are called “${c.name}”. Give them different names in Report.`, c.name);
    seenNames.add(c.name.toUpperCase());
  }
  for (const g of def.groupBy) if (!tableCol(g)) fail(`group-by column ${g} was not found in the combined data. Pick the new column in Report.`, g);

  const aggs: { col: AggColumn; of: string | null; sourceType: ColumnType | null; whereIndex: number }[] = [];
  const whereTexts: string[] = [];
  const whereCompiled: CompiledFormula[] = [];
  const formulas: { col: FormulaColumn; compiled: CompiledFormula }[] = [];

  for (const c of def.columns) {
    if (c.kind === 'group') {
      if (!def.groupBy.some((g) => same(g, c.from))) fail(`“${c.name}” shows ${c.from}, which is not in Group by. Add it to Group by in Report.`, c.name);
    } else if (c.kind === 'aggregate') {
      let ofName: string | null = null;
      let sourceType: ColumnType | null = null;
      if (c.agg !== 'COUNT' && !c.of) fail(`“${c.name}” needs a column to ${c.agg === 'COUNTDISTINCT' ? 'count' : c.agg.toLowerCase()}. Pick one in Report.`, c.name);
      if (c.of) {
        const t = tableCol(c.of);
        if (!t) fail(`“${c.name}” uses column ${c.of}, which was not found in the combined data. Pick the new column in Report.`, c.of);
        else {
          ofName = t.name;
          sourceType = t.type;
          if ((c.agg === 'SUM' || c.agg === 'AVG') && (t.type === 'text' || t.type === 'date')) fail(`“${c.name}”: ${c.agg} needs a number or money column, but ${t.name} is ${t.type}.`, c.name);
        }
      }
      let whereIndex = -1;
      if (c.where) {
        whereIndex = whereTexts.indexOf(c.where);
        if (whereIndex === -1) {
          try {
            const f = compileFormula(c.where);
            const unknown = f.columns.filter((n) => !tableCol(n));
            for (const n of unknown) fail(`“${c.name}”: the filter uses [${n}], but column ${n} was not found in the combined data.`, n);
            whereTexts.push(c.where);
            whereCompiled.push(f);
            whereIndex = whereTexts.length - 1;
          } catch (err) {
            fail(`“${c.name}”: the filter is not a valid formula: ${describeFormulaError(err)}`, c.name);
          }
        }
      }
      aggs.push({ col: c, of: ofName, sourceType, whereIndex });
    } else if (c.kind === 'formula') {
      try {
        const compiled = compileFormula(c.formula);
        for (const n of compiled.columns) {
          if (!def.columns.some((x) => same(x.name, n)) || same(n, c.name)) fail(`“${c.name}”: the formula uses [${n}], which is not another column of this report.`, n);
        }
        formulas.push({ col: c, compiled });
      } catch (err) {
        fail(`“${c.name}”: the formula is not valid: ${describeFormulaError(err)}`, c.name);
      }
    }
  }
  for (const s of def.sort ?? []) if (!def.columns.some((c) => same(c.name, s.column))) fail(`sorting by “${s.column}”, which is not a column of the report.`, s.column);

  // formula order: a formula comes after the formula columns it uses
  const ordered: typeof formulas = [];
  const pending = [...formulas];
  while (pending.length > 0) {
    const i = pending.findIndex((f) => f.compiled.columns.every((n) => !pending.some((p) => p !== f && same(p.col.name, n))));
    if (i === -1) {
      fail(`the formula columns ${pending.map((p) => `“${p.col.name}”`).join(', ')} use each other in a circle. Break the circle in Report.`);
      break;
    }
    ordered.push(...pending.splice(i, 1));
  }
  if (issues.length > 0) return empty();

  // --- one pass over the combined rows ---------------------------------------------------------
  const whereCtx = makeRowContext(table.columns, params);
  const whereErrors = new Map<number, { count: number; message: string }>();
  type Group = { gvals: Typed[]; accs: Acc[]; row: number };
  const groups = new Map<string, Group>();
  const total: Acc[] = aggs.map((a) => newAcc(a.col.agg === 'COUNTDISTINCT'));
  const groupCols = def.groupBy.map((g) => tableCol(g)?.name as string);
  const passes = new Array<boolean>(whereCompiled.length);

  const add = (acc: Acc, a: (typeof aggs)[number], row: CombinedRow) => {
    acc.rows++;
    if (a.of === null) return;
    const v = row[a.of] ?? null;
    if (v === null || v === '') return;
    acc.n++;
    if (a.col.agg === 'SUM' || a.col.agg === 'AVG') {
      if (typeof v === 'number') acc.sum += v;
    } else if (a.col.agg === 'COUNTDISTINCT') {
      acc.distinct?.add(String(v).trim().toUpperCase());
    } else if (a.col.agg === 'MIN') {
      if (acc.min === null || compare(v, acc.min) < 0) acc.min = v;
    } else if (a.col.agg === 'MAX') {
      if (acc.max === null || compare(v, acc.max) > 0) acc.max = v;
    }
  };

  table.rows.forEach((row, r) => {
    for (let w = 0; w < whereCompiled.length; w++) {
      try {
        passes[w] = toBool((whereCompiled[w] as CompiledFormula).evaluate(whereCtx(row)));
      } catch (err) {
        passes[w] = false;
        const e = whereErrors.get(w) ?? { count: 0, message: describeFormulaError(err) };
        e.count++;
        whereErrors.set(w, e);
      }
    }
    const gvals = groupCols.map((g) => row[g] ?? null);
    const key = gvals.map((v) => (v === null ? '' : String(v))).join('\u0001');
    let g = groups.get(key);
    if (!g) {
      g = { gvals, accs: aggs.map((a) => newAcc(a.col.agg === 'COUNTDISTINCT')), row: r };
      groups.set(key, g);
    }
    aggs.forEach((a, j) => {
      if (a.whereIndex !== -1 && !passes[a.whereIndex]) return;
      add(g.accs[j] as Acc, a, row);
      add(total[j] as Acc, a, row);
    });
  });
  for (const [w, e] of whereErrors) {
    const names = aggs.filter((a) => a.whereIndex === w).map((a) => `“${a.col.name}”`).join(', ');
    issues.push({ level: 'warning', message: `Report: the filter of ${names} could not be evaluated on ${e.count} row${e.count === 1 ? '' : 's'} (${e.message}). Those rows are not counted in ${names}.` });
  }

  // --- build the report rows -----------------------------------------------------------------
  const formulaCtx = makeRowContext(columns, params);
  const formulaErrors = new Map<string, { count: number; message: string }>();
  const runFormulas = (row: ReportRow) => {
    for (const f of ordered) {
      let value: Typed = null;
      try {
        const out: Value = f.compiled.evaluate(formulaCtx(row));
        value = convertValue(out as CellValue, f.col.type).value;
      } catch (err) {
        if (!(err instanceof FormulaError)) throw err;
        const e = formulaErrors.get(f.col.name) ?? { count: 0, message: describeFormulaError(err) };
        e.count++;
        formulaErrors.set(f.col.name, e);
      }
      row[f.col.name] = value;
    }
  };

  const built = [...groups.values()].map((g) => {
    const row: ReportRow = {};
    let j = 0;
    for (const c of def.columns) {
      if (c.kind === 'group') row[c.name] = g.gvals[def.groupBy.findIndex((x) => same(x, c.from))] ?? null;
      else if (c.kind === 'aggregate') {
        const a = aggs[j] as (typeof aggs)[number];
        row[c.name] = finish(c, g.accs[j] as Acc, a.sourceType);
        j++;
      } else row[c.name] = null; // serial and formula columns are filled below
    }
    runFormulas(row);
    return { row, gvals: g.gvals, first: g.row };
  });

  // --- sort, then number the rows ------------------------------------------------------------
  const sort = def.sort;
  if (sort === undefined) {
    // No sort chosen: alphabetical by the group-by columns, so the report reads the same every month.
    built.sort((a, b) => {
      for (let i = 0; i < groupCols.length; i++) {
        const d = compare(a.gvals[i] ?? null, b.gvals[i] ?? null);
        if (d !== 0) return d;
      }
      return a.first - b.first;
    });
  } else if (sort.length > 0) {
    built.sort((a, b) => {
      for (const s of sort) {
        const key = def.columns.find((c) => same(c.name, s.column))?.name as string;
        const d = compare(a.row[key] ?? null, b.row[key] ?? null);
        if (d !== 0) return s.dir === 'asc' ? d : -d;
      }
      return a.first - b.first;
    });
  }
  const rows = built.map((b) => b.row);
  const serials = def.columns.filter((c) => c.kind === 'serial');
  rows.forEach((row, i) => {
    for (const s of serials) row[s.name] = i + 1;
  });
  // serial numbers may be used by a formula: run those again now that they exist
  if (serials.length > 0 && ordered.some((f) => serials.some((s) => f.compiled.columns.some((n) => same(n, s.name))))) rows.forEach(runFormulas);

  // --- totals ----------------------------------------------------------------------------------
  let totals: ReportRow | null = null;
  if (def.totalsRow) {
    totals = {};
    let j = 0;
    let labelled = false;
    for (const c of def.columns) {
      if (c.kind === 'aggregate') {
        totals[c.name] = finish(c, total[j] as Acc, (aggs[j] as (typeof aggs)[number]).sourceType);
        j++;
      } else if (c.kind === 'group' && !labelled) {
        totals[c.name] = 'Total';
        labelled = true;
      } else totals[c.name] = null;
    }
    runFormulas(totals);
  }

  for (const [name, e] of formulaErrors) {
    issues.push({
      level: 'warning',
      column: name,
      message: `Report: the formula for “${name}” gave an error on ${e.count} row${e.count === 1 ? '' : 's'} (${e.message}). Those cells are left blank. Wrap the formula in IFERROR to choose the value.`,
    });
  }

  return { columns, rows, totals, issues, inputRows: table.rows.length };
}
