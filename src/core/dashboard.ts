// The dashboard engine: from saved Final months to the numbers of one tile.
//
// There is no calculation of its own here. Every row comes from MonthData, which is built
// with core/aggregate.ts from a run's facts and costs, and every measure (including Total
// Revenue and Gross Profit) is already worked out there. A tile only filters, groups and adds.
//
// Numbers are integer paise (or counts). An average is rounded to whole paise, once, at the end.

import { normaliseLabel } from './doctors';
import { doctorKey, type GroupLevel, type GroupRow, type MonthData } from './history';
import { getMeasure } from './measures';
import { previousMonth } from './dates';
import type { Dashboard, Dimension, Tile } from './schemas';
import type { MeasureCode } from './types';

/** Lines drawn when a tile is split by a dimension: the largest few. */
export const SPLIT_LIMIT = 8;

export type TileSeries = { name: string; values: (number | null)[] };

export type TileData = {
  tileId: string;
  /** ok: draw it; empty: nothing to show; unsupported: this combination cannot be calculated. */
  status: 'ok' | 'empty' | 'unsupported';
  /** Why it is empty or unsupported, in plain language. */
  message: string | null;
  /** Things the user should know even though the tile is drawn. */
  notes: string[];
  unit: 'money' | 'count';
  categories: { key: string; label: string }[];
  series: TileSeries[];
  /** The same series for the comparison month, lined up with the categories. */
  compare: { month: string; series: TileSeries[] } | null;
  /** The months the numbers come from. */
  monthsUsed: string[];
};

// ---------------------------------------------------------------------------
// Which months
// ---------------------------------------------------------------------------

/** Final months only, oldest first. A Draft is never shown on a dashboard. */
export function finalMonths(months: readonly MonthData[]): MonthData[] {
  return months.filter((m) => m.status === 'Final').sort((a, b) => a.month.localeCompare(b.month));
}

/** The months of a dashboard's range. */
export function monthsInRange(finals: readonly MonthData[], range: Dashboard['months']): MonthData[] {
  switch (range.mode) {
    case 'all':
      return [...finals];
    case 'latest':
      return finals.slice(-1);
    case 'last':
      return finals.slice(-range.count);
    case 'range':
      return finals.filter((m) => m.month >= range.from && m.month <= range.to);
  }
}

/** 'YYYY-MM' of the same month a year earlier. */
export function sameMonthLastYear(month: string): string {
  const [y = 0, m = ''] = month.split('-');
  return `${String(Number(y) - 1).padStart(4, '0')}-${m}`;
}

// ---------------------------------------------------------------------------
// What a tile needs
// ---------------------------------------------------------------------------

type Plan = { ok: true; level: GroupLevel } | { ok: false; reason: string };

/**
 * Numbers are kept per doctor, per department or per sponsor, never across them. So a tile may
 * use one of those dimensions (as X, split or filter), and a department filter may be added to
 * a doctor tile (a doctor has a department). Month can always be added.
 */
export function planTile(tile: Tile, dashboard: Dashboard): Plan {
  const departments = tile.filters.departments.length > 0 ? tile.filters.departments : dashboard.departments;
  const sponsors = tile.filters.sponsors.length > 0 ? tile.filters.sponsors : dashboard.sponsors;

  const shown = new Set<Dimension>(); // dimensions the tile draws
  if (tile.type !== 'kpi') shown.add(tile.x);
  if (tile.split) shown.add(tile.split);
  shown.delete('month');
  const filtered = new Set<Dimension>();
  if (tile.filters.doctors.length > 0) filtered.add('doctor');
  if (departments.length > 0) filtered.add('department');
  if (sponsors.length > 0) filtered.add('sponsor');

  const all = new Set([...shown, ...filtered]);
  if (all.size === 0) return { ok: true, level: 'doctor' };
  if (all.size === 1) return { ok: true, level: [...all][0] as GroupLevel };
  // A department filter on a doctor tile uses the doctor's own department.
  if (all.size === 2 && all.has('doctor') && all.has('department') && !shown.has('department')) return { ok: true, level: 'doctor' };

  const names = [...all].map((d) => d).join(' and ');
  return {
    ok: false,
    reason: `This tile uses ${names} together. Numbers are kept per doctor, per department or per sponsor, so they cannot be combined. Remove one of them (a department filter can be added to a doctor tile).`,
  };
}

const norm = (list: readonly string[]) => new Set(list.map(normaliseLabel));

/** Rows of a month that pass the tile's filters. */
function filteredRows(month: MonthData, level: GroupLevel, tile: Tile, dashboard: Dashboard): GroupRow[] {
  const departments = norm(tile.filters.departments.length > 0 ? tile.filters.departments : dashboard.departments);
  const sponsors = norm(tile.filters.sponsors.length > 0 ? tile.filters.sponsors : dashboard.sponsors);
  const doctors = new Set(tile.filters.doctors.map(doctorKey));

  return month.levels[level].filter((row) => {
    if (level === 'doctor') {
      if (doctors.size > 0 && !doctors.has(row.key)) return false;
      if (departments.size > 0 && !departments.has(normaliseLabel(row.department ?? ''))) return false;
    }
    if (level === 'department' && departments.size > 0 && !departments.has(normaliseLabel(row.key))) return false;
    if (level === 'sponsor' && sponsors.size > 0 && !sponsors.has(normaliseLabel(row.key))) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Adding up
// ---------------------------------------------------------------------------

/**
 * Sum, count (rows with something in them) or average of those rows. An average of amounts is
 * rounded to whole paise; an average of counts to one decimal (a count is not money).
 */
export function aggregate(values: readonly number[], how: Tile['agg'], isCount = false): number | null {
  const filled = values.filter((v) => v !== 0);
  switch (how) {
    case 'sum': {
      let total = 0;
      for (const v of values) total += v;
      if (!Number.isSafeInteger(total)) throw new TypeError('The total is too large to add up exactly');
      return total;
    }
    case 'count':
      return filled.length;
    case 'avg': {
      if (filled.length === 0) return null;
      let total = 0;
      for (const v of filled) total += v;
      return isCount ? Math.round((total / filled.length) * 10) / 10 : Math.round(total / filled.length);
    }
  }
}

type Cell = { x: string; xLabel: string; split: string; splitLabel: string; row: GroupRow };

/** The rows of the chosen months as cells: where each belongs on the X axis and in the split. */
function cellsFor(months: readonly MonthData[], level: GroupLevel, tile: Tile, dashboard: Dashboard): Cell[] {
  const cells: Cell[] = [];
  const dim = (d: Dimension | null, row: GroupRow, month: string): { key: string; label: string } => {
    if (d === 'month') return { key: month, label: month };
    if (d === null || d === 'doctor' || d === 'department' || d === 'sponsor') return { key: row.key, label: row.name };
    return { key: '', label: '' };
  };
  for (const m of months) {
    for (const row of filteredRows(m, level, tile, dashboard)) {
      const x = tile.type === 'kpi' ? { key: 'all', label: 'All' } : dim(tile.x, row, m.month);
      const s = tile.split ? dim(tile.split, row, m.month) : { key: '', label: '' };
      cells.push({ x: x.key, xLabel: x.label, split: s.key, splitLabel: s.label, row });
    }
  }
  return cells;
}

const isCount = (code: MeasureCode) => getMeasure(code).kind === 'count';

const total = (values: readonly (number | null)[]) => values.reduce<number>((n, v) => n + Math.abs(v ?? 0), 0);

/** The numbers of one set of months. Categories are returned in the order of `order` if given. */
function compute(
  tile: Tile,
  dashboard: Dashboard,
  level: GroupLevel,
  months: readonly MonthData[],
): { categories: { key: string; label: string }[]; series: TileSeries[] } {
  const cells = cellsFor(months, level, tile, dashboard);
  const measures: readonly MeasureCode[] = tile.measures;

  // KPI: one number per measure.
  if (tile.type === 'kpi') {
    return {
      categories: measures.map((m) => ({ key: m, label: getMeasure(m).label })),
      series: [{ name: 'Value', values: measures.map((m) => aggregate(cells.map((c) => c.row.values[m]), tile.agg, isCount(m))) }],
    };
  }

  const xs = new Map<string, string>();
  for (const c of cells) if (!xs.has(c.x)) xs.set(c.x, c.xLabel);
  const categories = [...xs.entries()].map(([key, label]) => ({ key, label }));

  const lines: { name: string; pick: (c: Cell) => boolean; measure: MeasureCode }[] = [];
  if (tile.split) {
    const names = new Map<string, string>();
    for (const c of cells) names.set(c.split, c.splitLabel);
    for (const [key, label] of names) lines.push({ name: label, pick: (c) => c.split === key, measure: measures[0] as MeasureCode });
  } else {
    for (const m of measures) lines.push({ name: getMeasure(m).label, pick: () => true, measure: m });
  }

  const series = lines.map((line) => ({
    name: line.name,
    values: categories.map((cat) => {
      const rows = cells.filter((c) => c.x === cat.key && line.pick(c)).map((c) => c.row.values[line.measure]);
      return rows.length === 0 ? null : aggregate(rows, tile.agg, isCount(line.measure));
    }),
  }));
  return { categories, series };
}

// ---------------------------------------------------------------------------
// One tile
// ---------------------------------------------------------------------------

function unsupported(tile: Tile, message: string): TileData {
  return { tileId: tile.id, status: 'unsupported', message, notes: [], unit: 'money', categories: [], series: [], compare: null, monthsUsed: [] };
}

function empty(tile: Tile, message: string, notes: string[] = []): TileData {
  return { tileId: tile.id, status: 'empty', message, notes, unit: 'money', categories: [], series: [], compare: null, monthsUsed: [] };
}

/** The numbers of a tile from the saved months (only Final ones are used). */
export function runTile(tile: Tile, dashboard: Dashboard, allMonths: readonly MonthData[]): TileData {
  const plan = planTile(tile, dashboard);
  if (!plan.ok) return unsupported(tile, plan.reason);

  const counts = tile.measures.filter(isCount).length;
  if (counts > 0 && counts < tile.measures.length && tile.agg !== 'count') {
    return unsupported(tile, 'IP Count is a count, not an amount. Draw it in its own tile instead of beside amounts.');
  }
  const unit: TileData['unit'] = counts > 0 || tile.agg === 'count' ? 'count' : 'money';

  const finals = finalMonths(allMonths);
  const inRange = monthsInRange(finals, dashboard.months);
  if (inRange.length === 0) {
    return empty(tile, finals.length === 0 ? 'There is no Final month yet. Run a month and make it Final.' : 'No Final month falls in the months chosen for this dashboard.');
  }

  const notes: string[] = [];
  const wantsCompare = tile.compare !== 'none';
  const comparable = wantsCompare && (tile.type === 'kpi' || tile.x !== 'month');
  if (wantsCompare && !comparable) notes.push('Compare applies to numbers and to charts by doctor, department or sponsor, not by month.');

  // With a comparison, the tile shows the latest month of the range against the other month.
  const primary = comparable ? inRange.slice(-1) : inRange;
  const level = plan.level;

  const missing = primary.filter((m) => m.levels[level].length === 0).map((m) => m.month);
  const usable = primary.filter((m) => m.levels[level].length > 0);
  if (missing.length > 0) notes.push(`${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} no ${level} numbers (an imported month has no sponsor detail) and ${missing.length === 1 ? 'is' : 'are'} left out.`);
  if (usable.length === 0) return empty(tile, `The months chosen have no ${level}-wise numbers.`, notes);

  const main = compute(tile, dashboard, level, usable);
  if (main.categories.length === 0 || main.series.every((s) => s.values.every((v) => v === null))) {
    return empty(tile, 'No rows match this tile’s filters in the months chosen.', notes);
  }

  let { categories, series } = main;
  const isKpi = tile.type === 'kpi';

  // Order and limit the categories (months stay in time order).
  if (!isKpi) {
    if (tile.x === 'month') {
      const order = categories.map((_, i) => i).sort((a, b) => (categories[a]?.key ?? '').localeCompare(categories[b]?.key ?? ''));
      categories = order.map((i) => categories[i] as (typeof categories)[number]);
      series = series.map((s) => ({ ...s, values: order.map((i) => s.values[i] ?? null) }));
    } else {
      const weight = categories.map((_, i) => series.reduce((n, s) => n + Math.abs(s.values[i] ?? 0), 0));
      const signed = categories.map((_, i) => series.reduce((n, s) => n + (s.values[i] ?? 0), 0));
      let order = categories.map((_, i) => i);
      if (tile.sort === 'name') order.sort((a, b) => (categories[a]?.label ?? '').localeCompare(categories[b]?.label ?? '', 'en', { sensitivity: 'base' }));
      else order.sort((a, b) => (tile.sort === 'asc' ? (signed[a] ?? 0) - (signed[b] ?? 0) : (signed[b] ?? 0) - (signed[a] ?? 0)));
      if (tile.topN !== null) {
        // Keep the largest by size, shown in the chosen order.
        const keep = new Set([...order].sort((a, b) => (weight[b] ?? 0) - (weight[a] ?? 0)).slice(0, tile.topN));
        order = order.filter((i) => keep.has(i));
      }
      categories = order.map((i) => categories[i] as (typeof categories)[number]);
      series = series.map((s) => ({ ...s, values: order.map((i) => s.values[i] ?? null) }));
    }
  }

  // A split into many lines keeps the largest few.
  if (tile.split && series.length > SPLIT_LIMIT) {
    const top = [...series].sort((a, b) => total(b.values) - total(a.values)).slice(0, SPLIT_LIMIT);
    notes.push(`Only the ${SPLIT_LIMIT} largest of ${series.length} are drawn.`);
    series = series.filter((s) => top.includes(s));
  }

  // The comparison month, lined up with the categories above.
  let compare: TileData['compare'] = null;
  if (comparable) {
    const latest = primary[0] as MonthData;
    const wanted = tile.compare === 'previousMonth' ? previousMonth(latest.month) : sameMonthLastYear(latest.month);
    const other = finals.find((m) => m.month === wanted && m.levels[level].length > 0);
    if (!other) {
      notes.push(`There is no Final month ${wanted} to compare ${latest.month} with.`);
    } else {
      const base = compute(tile, dashboard, level, [other]);
      const index = new Map(base.categories.map((c, i) => [c.key, i]));
      const byName = new Map(base.series.map((s) => [s.name, s]));
      compare = {
        month: wanted,
        series: series.map((s) => {
          const theirs = byName.get(s.name);
          return { name: s.name, values: categories.map((c) => (theirs ? (theirs.values[index.get(c.key) ?? -1] ?? null) : null)) };
        }),
      };
    }
  }

  if (tile.type === 'pie' && series.some((s) => s.values.some((v) => v !== null && v < 0))) {
    notes.push('A pie chart cannot show negative amounts; they are left out of the pie. Use a bar chart to see them.');
  }

  return { tileId: tile.id, status: 'ok', message: null, notes, unit, categories, series, compare, monthsUsed: usable.map((m) => m.month) };
}

/** Every tile of a dashboard. */
export function runDashboard(dashboard: Dashboard, months: readonly MonthData[]): TileData[] {
  return dashboard.tiles.map((t) => runTile(t, dashboard, months));
}

/** The names a filter can offer: every doctor, department or sponsor in the Final months. */
export function filterChoices(months: readonly MonthData[]): Record<'doctors' | 'departments' | 'sponsors', string[]> {
  const sets = { doctors: new Map<string, string>(), departments: new Map<string, string>(), sponsors: new Map<string, string>() };
  for (const m of finalMonths(months)) {
    for (const r of m.levels.doctor) sets.doctors.set(r.key, r.name);
    for (const r of m.levels.department) sets.departments.set(r.key, r.name);
    for (const r of m.levels.sponsor) sets.sponsors.set(r.key, r.name);
  }
  const sorted = (m: Map<string, string>) => [...m.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  return { doctors: sorted(sets.doctors), departments: sorted(sets.departments), sponsors: sorted(sets.sponsors) };
}
