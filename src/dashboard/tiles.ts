// The tile engine: from a tile spec and the loaded data to the numbers a tile shows. Pure functions, no React.
//
// Sums of money are done in integer paise (rupees * 100, rounded once per value), so adding up never drifts.
// Nothing is dropped silently: a row the tile's filter cannot judge, a series that is cut, a negative amount a pie
// cannot draw: each one is counted in the tile's `notes`.

import { toPaise } from '@/core/money';
import { makeRowContext } from '@/engine/rowContext';
import { compileFormula, describeFormulaError, toBool } from '@/formula';
import type { Tile, TileAgg } from './schema';
import type { DashboardData, DashRow, DashValue } from './data';

export type Filters = Readonly<Record<string, readonly string[]>>;
export type Format = 'money' | 'number';

export type TableColumn = { key: string; label: string; format: 'text' | 'money' | 'number' | 'percent' };

export type TileResult =
  | { status: 'error' | 'empty'; message: string }
  | { status: 'ok'; kind: 'kpi'; value: number | null; previous: number | null; change: number | null; changePct: number | null; period: { latest: string; previous: string } | null; format: Format; notes: string[] }
  | { status: 'ok'; kind: 'chart'; categories: string[]; series: { name: string; values: (number | null)[] }[]; format: Format; notes: string[] }
  | { status: 'ok'; kind: 'table'; columns: TableColumn[]; rows: Record<string, DashValue>[]; notes: string[] };

const MAX_SERIES = 12;
const MAX_PIVOT = 8;

// ---------------------------------------------------------------------------
// Months and natural order
// ---------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Oct-2026", "October 2026", "Oct-26" or "2026-10" → "2026-10"; null for anything else. */
export function monthKey(label: string): string | null {
  const s = label.trim();
  let m = /^([A-Za-z]{3,9})[-\s/.,]+(\d{4}|\d{2})$/.exec(s);
  if (m) {
    const i = MONTHS.indexOf((m[1] as string).slice(0, 3).toLowerCase());
    if (i === -1) return null;
    const year = (m[2] as string).length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return `${year}-${String(i + 1).padStart(2, '0')}`;
  }
  m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${String(m[2]).padStart(2, '0')}`;
  return null;
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

/** Periods oldest first: by calendar month when they all look like months, otherwise in natural order. */
export function orderPeriods(values: readonly string[]): string[] {
  const unique = [...new Set(values)];
  const keys = unique.map(monthKey);
  if (keys.every((k) => k !== null)) return unique.map((v, i) => ({ v, k: keys[i] as string })).sort((a, b) => a.k.localeCompare(b.k)).map((x) => x.v);
  return unique.sort(natural);
}

// ---------------------------------------------------------------------------
// Aggregation (money in integer paise)
// ---------------------------------------------------------------------------

type Acc = { rows: number; n: number; sum: number; min: number | null; max: number | null };

function aggregate(rows: readonly DashRow[], column: string, agg: TileAgg, money: boolean): number | null {
  const acc: Acc = { rows: 0, n: 0, sum: 0, min: null, max: null };
  for (const r of rows) {
    acc.rows++;
    const v = r[column];
    if (v === null || v === undefined || v === '') continue;
    acc.n++;
    if (typeof v !== 'number') continue;
    const x = money ? (toPaise(v) ?? 0) : v;
    acc.sum += x;
    acc.min = acc.min === null || x < acc.min ? x : acc.min;
    acc.max = acc.max === null || x > acc.max ? x : acc.max;
  }
  const out = (x: number) => (money ? x / 100 : Number(x.toPrecision(15)));
  switch (agg) {
    case 'SUM':
      return out(acc.sum);
    case 'COUNT':
      return acc.n;
    case 'AVG':
      return acc.n === 0 ? null : money ? Math.round(acc.sum / acc.n) / 100 : Number((acc.sum / acc.n).toPrecision(15));
    case 'MIN':
      return acc.min === null ? null : out(acc.min);
    case 'MAX':
      return acc.max === null ? null : out(acc.max);
  }
}

// ---------------------------------------------------------------------------
// Rows after the global filters and the tile's own filter
// ---------------------------------------------------------------------------

export function filterRows(data: DashboardData, filters: Filters, tileFilter: string | undefined): { rows: DashRow[]; unjudged: number } {
  let rows = data.rows;
  for (const [column, selected] of Object.entries(filters)) {
    if (selected.length === 0) continue;
    const set = new Set(selected);
    rows = rows.filter((r) => set.has(String(r[column] ?? '')));
  }
  if (!tileFilter || tileFilter.trim() === '') return { rows, unjudged: 0 };

  const formula = compileFormula(tileFilter);
  // values are already rupees here, so money is a plain number for the formula (no paise to rupees step)
  const ctx = makeRowContext(data.columns.map((c) => ({ name: c.name, type: c.type === 'money' ? 'number' : c.type })));
  let unjudged = 0;
  const kept = rows.filter((r) => {
    try {
      return toBool(formula.evaluate(ctx(r)));
    } catch {
      unjudged++;
      return false;
    }
  });
  return { rows: kept, unjudged };
}

// ---------------------------------------------------------------------------
// One tile
// ---------------------------------------------------------------------------

const moneyOf = (data: DashboardData, column: string) => data.columns.find((c) => c.name === column)?.type === 'money';
const has = (data: DashboardData, column: string) => data.columns.some((c) => c.name === column);

/** Columns a tile uses, in plain order (for validation and for "required columns"). */
export function tileColumns(tile: Tile): string[] {
  return [...new Set([tile.x, tile.y.column, ...(tile.extraY ?? []).map((m) => m.column), tile.splitBy, tile.compare?.column].filter((c): c is string => !!c))];
}

type Measure = { column: string; agg: TileAgg; label: string };

const measuresOf = (tile: Tile): Measure[] => [tile.y, ...(tile.extraY ?? [])].map((m) => ({ ...m, label: m.agg === 'SUM' ? m.column : `${m.column} (${m.agg.toLowerCase()})` }));

/** a - b, exact for money (in paise) and clean for other numbers. */
function difference(a: number, b: number, money: boolean): number {
  return money ? ((toPaise(a) ?? 0) - (toPaise(b) ?? 0)) / 100 : Number((a - b).toPrecision(15));
}

/** Categories in the order the tile asks for: by value, or by label (months in calendar order). */
function orderCategories(categories: string[], total: (c: string) => number, tile: Tile, isPeriod: boolean): string[] {
  const byValue = (dir: 1 | -1) => [...categories].sort((a, b) => dir * (total(b) - total(a)) || natural(a, b));
  const byLabel = () => (isPeriod ? orderPeriods(categories) : [...categories].sort(natural));
  const sort = tile.sort ?? (tile.type === 'line' ? 'label' : 'valueDesc');
  let list = sort === 'valueAsc' ? byValue(-1) : sort === 'label' ? byLabel() : byValue(1);
  if (tile.topN !== undefined && list.length > tile.topN) {
    const top = new Set(byValue(1).slice(0, tile.topN)); // the N largest, whatever the display order is
    list = list.filter((c) => top.has(c));
  }
  return list;
}

export function computeTile(tile: Tile, data: DashboardData, filters: Filters = {}): TileResult {
  const missing = tileColumns(tile).filter((c) => !has(data, c));
  if (missing.length > 0) return { status: 'error', message: `The loaded data has no column ${missing.map((c) => `“${c}”`).join(', ')}. Pick another column, or load the right report files.` };
  if (data.rows.length === 0) return { status: 'empty', message: 'There is no data yet. Load a report first.' };

  let filtered;
  try {
    filtered = filterRows(data, filters, tile.filter);
  } catch (err) {
    return { status: 'error', message: `The filter of this tile is not valid: ${describeFormulaError(err)}` };
  }
  const { rows, unjudged } = filtered;
  const notes: string[] = unjudged > 0 ? [`${unjudged} row${unjudged === 1 ? '' : 's'} could not be judged by the tile's filter and ${unjudged === 1 ? 'was' : 'were'} left out.`] : [];
  if (rows.length === 0) return { status: 'empty', message: 'No rows match the filters.' };

  const measures = measuresOf(tile);
  const money = moneyOf(data, tile.y.column);
  const format: Format = money ? 'money' : 'number';
  const compareCol = tile.compare?.column;
  const periodsOf = (rs: readonly DashRow[]) => (compareCol ? orderPeriods(rs.map((r) => String(r[compareCol] ?? '')).filter((p) => p !== '')) : []);

  // ---- KPI ------------------------------------------------------------------------------------
  if (tile.type === 'kpi') {
    const periods = periodsOf(rows);
    if (compareCol && periods.length >= 2) {
      const latest = periods[periods.length - 1] as string;
      const previous = periods[periods.length - 2] as string;
      const of = (p: string) => aggregate(rows.filter((r) => String(r[compareCol] ?? '') === p), tile.y.column, tile.y.agg, money);
      const value = of(latest);
      const before = of(previous);
      const change = value !== null && before !== null ? difference(value, before, money) : null;
      const changePct = change !== null && before !== null && before !== 0 ? (change / Math.abs(before)) * 100 : null;
      return { status: 'ok', kind: 'kpi', value, previous: before, change, changePct, period: { latest, previous }, format, notes };
    }
    if (compareCol) notes.push(`Only one ${compareCol} is loaded, so there is nothing to compare with yet.`);
    return { status: 'ok', kind: 'kpi', value: aggregate(rows, tile.y.column, tile.y.agg, money), previous: null, change: null, changePct: null, period: null, format, notes };
  }

  // ---- charts and tables need an X ---------------------------------------------------------------
  const x = tile.x;
  if (!x) return { status: 'error', message: 'Choose what to group by (X) for this tile.' };
  if (tile.splitBy && measures.length > 1) return { status: 'error', message: 'Use either “split by” or several measures, not both.' };
  const isPeriod = x === compareCol || x.toUpperCase() === 'MONTH';
  const catOf = (r: DashRow) => String(r[x] ?? '') || '(blank)';
  const categories = [...new Set(rows.map(catOf))];

  // A group with no rows at all is blank (not 0): "nothing there" is different from "adds up to nothing".
  const valueFor = (rs: readonly DashRow[], m: Measure) => (rs.length === 0 ? null : aggregate(rs, m.column, m.agg, moneyOf(data, m.column)));
  const rowsByCat = new Map<string, DashRow[]>();
  for (const r of rows) {
    const c = catOf(r);
    const list = rowsByCat.get(c);
    if (list) list.push(r);
    else rowsByCat.set(c, [r]);
  }
  const catTotal = (c: string) => valueFor(rowsByCat.get(c) ?? [], measures[0] as Measure) ?? 0;

  // ---- table ---------------------------------------------------------------------------------------
  if (tile.type === 'table') {
    const periods = x === compareCol ? [] : periodsOf(rows);
    const cols: TableColumn[] = [{ key: 'x', label: x, format: 'text' }];
    const out: Record<string, DashValue>[] = [];
    const m = measures[0] as Measure;
    const mFormat = moneyOf(data, m.column) ? 'money' : 'number';

    if (compareCol && periods.length >= 2) {
      const latest = periods[periods.length - 1] as string;
      const previous = periods[periods.length - 2] as string;
      cols.push({ key: 'latest', label: latest, format: mFormat }, { key: 'previous', label: previous, format: mFormat }, { key: 'change', label: 'Change', format: mFormat }, { key: 'pct', label: 'Change %', format: 'percent' });
      const totalLatest = (c: string) => valueFor((rowsByCat.get(c) ?? []).filter((r) => String(r[compareCol] ?? '') === latest), m) ?? 0;
      const order = orderCategories(categories, totalLatest, tile, false);
      for (const c of order) {
        const inCat = rowsByCat.get(c) ?? [];
        const a = valueFor(inCat.filter((r) => String(r[compareCol] ?? '') === latest), m);
        const b = valueFor(inCat.filter((r) => String(r[compareCol] ?? '') === previous), m);
        const change = a !== null && b !== null ? difference(a, b, mFormat === 'money') : a !== null ? a : null;
        out.push({ x: c, latest: a, previous: b, change, pct: change !== null && b !== null && b !== 0 ? (change / Math.abs(b)) * 100 : null });
      }
      return { status: 'ok', kind: 'table', columns: cols, rows: out, notes };
    }
    if (compareCol) notes.push(`Only one ${compareCol} is loaded, so the table shows the value without a comparison.`);

    if (tile.splitBy) {
      const splitCol = tile.splitBy;
      const splits = [...new Set(rows.map((r) => String(r[splitCol] ?? '') || '(blank)'))].sort(natural);
      const shown = splits.slice(0, MAX_PIVOT);
      if (splits.length > shown.length) notes.push(`${splits.length - shown.length} more ${splitCol} values are not shown.`);
      shown.forEach((s, i) => cols.push({ key: `s${i}`, label: s, format: mFormat }));
      for (const c of orderCategories(categories, catTotal, tile, isPeriod)) {
        const row: Record<string, DashValue> = { x: c };
        shown.forEach((s, i) => (row[`s${i}`] = valueFor((rowsByCat.get(c) ?? []).filter((r) => (String(r[splitCol] ?? '') || '(blank)') === s), m)));
        out.push(row);
      }
      return { status: 'ok', kind: 'table', columns: cols, rows: out, notes };
    }
    for (const mm of measures) cols.push({ key: mm.column, label: mm.label, format: moneyOf(data, mm.column) ? 'money' : 'number' });
    for (const c of orderCategories(categories, catTotal, tile, isPeriod)) {
      const row: Record<string, DashValue> = { x: c };
      for (const mm of measures) row[mm.column] = valueFor(rowsByCat.get(c) ?? [], mm);
      out.push(row);
    }
    return { status: 'ok', kind: 'table', columns: cols, rows: out, notes };
  }

  // ---- charts -------------------------------------------------------------------------------------------
  const order = orderCategories(categories, catTotal, tile, isPeriod);
  if (tile.topN !== undefined && categories.length > order.length) notes.push(`Showing the top ${order.length} of ${categories.length}.`);
  let series: { name: string; values: (number | null)[] }[];

  if (tile.splitBy) {
    const splitCol = tile.splitBy;
    const m = measures[0] as Measure;
    const splitTotals = new Map<string, number>();
    for (const [s, rs] of groupBy(rows, (r) => String(r[splitCol] ?? '') || '(blank)')) splitTotals.set(s, Math.abs(valueFor(rs, m) ?? 0));
    const splits = [...splitTotals.keys()].sort((a, b) => (splitTotals.get(b) ?? 0) - (splitTotals.get(a) ?? 0) || natural(a, b));
    const shown = splits.slice(0, MAX_SERIES);
    if (splits.length > shown.length) notes.push(`${splits.length - shown.length} smaller ${splitCol} values are not drawn (the largest ${MAX_SERIES} are).`);
    series = shown.map((s) => ({ name: s, values: order.map((c) => valueFor((rowsByCat.get(c) ?? []).filter((r) => (String(r[splitCol] ?? '') || '(blank)') === s), m)) }));
  } else if (compareCol && x !== compareCol && tile.type !== 'pie' && tile.type !== 'stackedBar' && periodsOf(rows).length >= 2) {
    const periods = periodsOf(rows);
    const [previous, latest] = [periods[periods.length - 2] as string, periods[periods.length - 1] as string];
    series = measures.flatMap((m) =>
      [previous, latest].map((p) => ({ name: measures.length > 1 ? `${m.label} (${p})` : p, values: order.map((c) => valueFor((rowsByCat.get(c) ?? []).filter((r) => String(r[compareCol] ?? '') === p), m)) })),
    );
  } else {
    if (compareCol && x !== compareCol) notes.push(tile.type === 'pie' || tile.type === 'stackedBar' ? 'Comparing with the previous period is shown on bar, line and table tiles.' : `Only one ${compareCol} is loaded, so there is nothing to compare with yet.`);
    series = measures.map((m) => ({ name: m.label, values: order.map((c) => valueFor(rowsByCat.get(c) ?? [], m)) }));
  }
  if (tile.type === 'pie') {
    const first = series[0];
    const negatives = first ? first.values.filter((v) => v !== null && v < 0).length : 0;
    if (negatives > 0) notes.push(`${negatives} negative value${negatives === 1 ? '' : 's'} cannot be drawn in a pie and ${negatives === 1 ? 'is' : 'are'} left out.`);
  }
  return { status: 'ok', kind: 'chart', categories: order, series, format, notes };
}

function groupBy<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const t of items) {
    const k = key(t);
    const list = out.get(k);
    if (list) list.push(t);
    else out.set(k, [t]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Values for the filter drop-downs
// ---------------------------------------------------------------------------

/** The distinct values of a column, in natural order (months in calendar order). */
export function filterValues(data: DashboardData, column: string): string[] {
  const values = [...new Set(data.rows.map((r) => String(r[column] ?? '')).filter((v) => v !== ''))];
  return column.toUpperCase() === 'MONTH' ? orderPeriods(values) : values.sort(natural);
}
