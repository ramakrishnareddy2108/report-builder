import { describe, expect, it } from 'vitest';
import { aggregate, filterChoices, finalMonths, monthsInRange, planTile, runDashboard, runTile, sameMonthLastYear, SPLIT_LIMIT } from '@/core/dashboard';
import { STARTER_DASHBOARDS, starterDashboardsFile } from '@/core/dashboardStarters';
import type { GroupRow, MonthData } from '@/core/history';
import { computeMeasure, MEASURES } from '@/core/measures';
import { DashboardsFileSchema, type Dashboard, type Tile } from '@/core/schemas';
import { MEASURE_CODES, type MeasureCode } from '@/core/types';

// --- a small made-up history ---------------------------------------------------

function values(parts: Partial<Record<MeasureCode, number>>): GroupRow['values'] {
  const inputs: Partial<Record<MeasureCode, number>> = {};
  for (const m of MEASURES) if (m.kind !== 'calc') inputs[m.code] = parts[m.code] ?? 0;
  return Object.fromEntries(MEASURE_CODES.map((c) => [c, computeMeasure(c, inputs)])) as GroupRow['values'];
}
const row = (key: string, name: string, parts: Partial<Record<MeasureCode, number>>, department?: string): GroupRow => ({ key, name, values: values(parts), ...(department ? { department } : {}) });

function month(m: string, status: 'Final' | 'Draft', doctors: GroupRow[], departments: GroupRow[], sponsors: GroupRow[]): MonthData {
  const totals = values(Object.fromEntries(MEASURE_CODES.filter((c) => MEASURES.find((x) => x.code === c)?.kind !== 'calc').map((c) => [c, doctors.reduce((n, r) => n + r.values[c], 0)])));
  return { month: m, runNumber: 1, status, kind: 'run', levels: { doctor: doctors, department: departments, sponsor: sponsors }, totals, checks: null };
}

const A = (rev: number, ip = 0) => row('A KUMAR', 'A Kumar', { OP_REVENUE: rev, IP_COUNT: ip, SALARY: 1000 }, 'Cardiology');
const B = (rev: number) => row('B RAO', 'B Rao', { OP_REVENUE: rev }, 'Urology');
const C = (rev: number) => row('C SEN', 'C Sen', { OP_REVENUE: rev }, 'Cardiology');

const jan = month('2026-01', 'Final', [A(10000, 2), B(5000)], [row('CARDIOLOGY', 'CARDIOLOGY', { OP_REVENUE: 10000 }), row('UROLOGY', 'UROLOGY', { OP_REVENUE: 5000 })], [row('GENERAL', 'GENERAL', { OP_REVENUE: 12000 }), row('STAR', 'STAR', { OP_REVENUE: 3000 })]);
const feb = month('2026-02', 'Final', [A(15000, 3), B(5000), C(2000)], [row('CARDIOLOGY', 'CARDIOLOGY', { OP_REVENUE: 17000 }), row('UROLOGY', 'UROLOGY', { OP_REVENUE: 5000 })], [row('GENERAL', 'GENERAL', { OP_REVENUE: 20000 }), row('STAR', 'STAR', { OP_REVENUE: 2000 })]);
const mar = month('2026-03', 'Draft', [A(99999)], [], []); // a Draft is never shown
const months = [feb, mar, jan]; // deliberately out of order

const tile = (over: Partial<Tile> = {}): Tile => ({
  id: 't', title: 'T', type: 'bar', x: 'month', measures: ['OP_REVENUE'], agg: 'sum', split: null,
  filters: { doctors: [], departments: [], sponsors: [] }, topN: null, sort: 'desc', compare: 'none', ...over,
});
const dash = (over: Partial<Dashboard> = {}): Dashboard => ({ id: 'd', name: 'D', months: { mode: 'all' }, departments: [], sponsors: [], tiles: [], ...over });
const run = (t: Tile, d = dash()) => runTile(t, d, months);
const labels = (r: ReturnType<typeof run>) => r.categories.map((c) => c.label);
const vals = (r: ReturnType<typeof run>, i = 0) => r.series[i]?.values;

describe('which months', () => {
  it('uses Final months only, oldest first', () => {
    expect(finalMonths(months).map((m) => m.month)).toEqual(['2026-01', '2026-02']);
  });
  it('picks a range: all, latest, the last N, or from-to', () => {
    const finals = finalMonths(months);
    expect(monthsInRange(finals, { mode: 'all' })).toHaveLength(2);
    expect(monthsInRange(finals, { mode: 'latest' }).map((m) => m.month)).toEqual(['2026-02']);
    expect(monthsInRange(finals, { mode: 'last', count: 1 }).map((m) => m.month)).toEqual(['2026-02']);
    expect(monthsInRange(finals, { mode: 'range', from: '2026-01', to: '2026-01' }).map((m) => m.month)).toEqual(['2026-01']);
  });
  it('finds the same month last year', () => expect(sameMonthLastYear('2026-02')).toBe('2025-02'));
});

describe('adding up', () => {
  it('sum, count (rows with something in them) and average (of those rows)', () => {
    expect(aggregate([100, 0, 300], 'sum')).toBe(400);
    expect(aggregate([100, 0, 300], 'count')).toBe(2);
    expect(aggregate([100, 0, 301], 'avg')).toBe(201); // rounded to whole paise
    expect(aggregate([0, 0], 'avg')).toBeNull();
  });
  it('an average of counts keeps one decimal, an amount never has a fraction of a paisa', () => {
    expect(aggregate([2, 3], 'avg', true)).toBe(2.5);
    expect(Number.isInteger(aggregate([1, 2], 'avg') as number)).toBe(true);
  });
  it('refuses a total that is not exact', () => {
    expect(() => aggregate([Number.MAX_SAFE_INTEGER, 5], 'sum')).toThrow(/exactly/);
  });
});

describe('a tile by month', () => {
  it('has one value per month in time order, and ignores a Draft month', () => {
    const r = run(tile());
    expect(r.status).toBe('ok');
    expect(labels(r)).toEqual(['2026-01', '2026-02']);
    expect(vals(r)).toEqual([15000, 22000]); // sums of the doctors of each month
    expect(r.monthsUsed).toEqual(['2026-01', '2026-02']);
  });

  it('draws one series per measure, with calculated measures taken from the numbers already worked out', () => {
    const r = run(tile({ measures: ['OP_REVENUE', 'TOTAL_REVENUE', 'GROSS_PROFIT'] }));
    expect(r.series.map((s) => s.name)).toEqual(['OP Revenue', 'Total Revenue', 'Gross Profit']);
    expect(vals(r, 1)).toEqual([15000, 22000]);
    expect(vals(r, 2)).toEqual([15000 - 1000, 22000 - 1000]); // minus A Kumar's salary
  });

  it('count and average work over the doctors of each month', () => {
    expect(vals(run(tile({ agg: 'count' })))).toEqual([2, 3]);
    expect(vals(run(tile({ agg: 'avg' })))).toEqual([7500, Math.round(22000 / 3)]);
  });

  it('follows the dashboard month range', () => {
    expect(labels(run(tile(), dash({ months: { mode: 'latest' } })))).toEqual(['2026-02']);
  });
});

describe('a tile by doctor, department or sponsor', () => {
  it('adds a doctor up over the months, sorted largest first, with a top N', () => {
    const r = run(tile({ x: 'doctor', topN: 2 }));
    expect(labels(r)).toEqual(['A Kumar', 'B Rao']); // C Sen (2,000) is cut
    expect(vals(r)).toEqual([25000, 10000]);
  });

  it('sorts ascending or by name', () => {
    expect(labels(run(tile({ x: 'doctor', sort: 'asc' })))).toEqual(['C Sen', 'B Rao', 'A Kumar']);
    expect(labels(run(tile({ x: 'doctor', sort: 'name' })))).toEqual(['A Kumar', 'B Rao', 'C Sen']);
  });

  it('keeps the largest by size even when sorted by name', () => {
    expect(labels(run(tile({ x: 'doctor', topN: 2, sort: 'name' })))).toEqual(['A Kumar', 'B Rao']);
  });

  it('uses the department and sponsor rows of each month', () => {
    expect(vals(run(tile({ x: 'department' })))).toEqual([27000, 10000]);
    expect(labels(run(tile({ x: 'sponsor', sort: 'name' })))).toEqual(['GENERAL', 'STAR']);
    expect(vals(run(tile({ x: 'sponsor', sort: 'name' })))).toEqual([32000, 5000]);
  });

  it('a pie warns about negative amounts', () => {
    const neg = month('2026-04', 'Final', [row('X', 'X', { OP_REVENUE: -500 }), A(100)], [], []);
    const r = runTile(tile({ type: 'pie', x: 'doctor' }), dash(), [neg]);
    expect(r.notes.join(' ')).toMatch(/cannot show negative amounts/);
  });
});

describe('split by', () => {
  it('draws a line per split value over the months', () => {
    const r = run(tile({ type: 'line', split: 'department' }));
    expect(r.series.map((s) => s.name).sort()).toEqual(['CARDIOLOGY', 'UROLOGY']);
    expect(r.series.find((s) => s.name === 'CARDIOLOGY')?.values).toEqual([10000, 17000]);
  });

  it('by doctor, split by month gives a column per month', () => {
    const r = run(tile({ x: 'doctor', split: 'month', sort: 'name' }));
    expect(r.series.map((s) => s.name)).toEqual(['2026-01', '2026-02']);
    expect(r.series[1]?.values).toEqual([15000, 5000, 2000]);
    expect(r.series[0]?.values).toEqual([10000, 5000, null]); // C Sen has no row in January
  });

  it('keeps the largest few lines and says so', () => {
    const many = month('2026-05', 'Final', Array.from({ length: 12 }, (_, i) => row(`D${i}`, `Doctor ${i}`, { OP_REVENUE: (i + 1) * 100 })), [], []);
    const r = runTile(tile({ type: 'line', split: 'doctor' }), dash(), [many]);
    expect(r.series).toHaveLength(SPLIT_LIMIT);
    expect(r.notes.join(' ')).toContain(`Only the ${SPLIT_LIMIT} largest of 12`);
    expect(r.series.map((s) => s.name)).toContain('Doctor 11');
  });
});

describe('filters', () => {
  it('a department filter on a doctor tile uses the department of the doctor', () => {
    expect(labels(run(tile({ x: 'doctor', filters: { doctors: [], departments: ['cardiology'], sponsors: [] } })))).toEqual(['A Kumar', 'C Sen']);
  });

  it('a department filter on a month tile adds up the departments chosen', () => {
    expect(vals(run(tile({ filters: { doctors: [], departments: ['Urology'], sponsors: [] } })))).toEqual([5000, 5000]);
  });

  it('a sponsor filter on a month tile adds up the sponsors chosen', () => {
    expect(vals(run(tile({ filters: { doctors: [], departments: [], sponsors: ['star'] } })))).toEqual([3000, 2000]);
  });

  it('a doctor filter matches names however they are spelt', () => {
    expect(vals(run(tile({ x: 'doctor', filters: { doctors: ['Dr. A.Kumar'], departments: [], sponsors: [] } })))).toEqual([25000]);
  });

  it('the dashboard filter applies unless the tile has its own', () => {
    const d = dash({ departments: ['Urology'] });
    expect(vals(run(tile(), d))).toEqual([5000, 5000]);
    expect(vals(run(tile({ filters: { doctors: [], departments: ['Cardiology'], sponsors: [] } }), d))).toEqual([10000, 17000]);
  });

  it('says so when no row matches', () => {
    const r = run(tile({ x: 'doctor', filters: { doctors: ['Nobody'], departments: [], sponsors: [] } }));
    expect(r).toMatchObject({ status: 'empty', message: expect.stringContaining('No rows match') });
  });
});

describe('what cannot be calculated', () => {
  it('sponsor with department cannot be combined, and says why', () => {
    const r = run(tile({ x: 'sponsor', filters: { doctors: [], departments: ['Urology'], sponsors: [] } }));
    expect(r.status).toBe('unsupported');
    expect(r.message).toMatch(/sponsor and department together/i);
    expect(planTile(tile({ x: 'department', split: 'sponsor' }), dash()).ok).toBe(false);
    expect(planTile(tile({ x: 'doctor', split: 'department' }), dash()).ok).toBe(false);
  });

  it('allows the combinations that can be calculated', () => {
    for (const t of [tile(), tile({ x: 'doctor' }), tile({ x: 'doctor', split: 'month' }), tile({ split: 'sponsor' }), tile({ x: 'doctor', filters: { doctors: [], departments: ['X'], sponsors: [] } })]) {
      expect(planTile(t, dash()).ok).toBe(true);
    }
  });

  it('does not put counts beside amounts', () => {
    expect(run(tile({ measures: ['IP_COUNT', 'OP_REVENUE'] })).status).toBe('unsupported');
    expect(run(tile({ measures: ['IP_COUNT'] })).unit).toBe('count');
  });

  it('is empty, with a reason, when no month qualifies', () => {
    expect(runTile(tile(), dash(), [mar]).message).toMatch(/no Final month yet/i);
    expect(run(tile(), dash({ months: { mode: 'range', from: '2030-01', to: '2030-02' } })).message).toMatch(/No Final month falls in/);
  });

  it('leaves out a month with no rows of the needed kind and says so (imported months have no sponsors)', () => {
    const imported = { ...jan, month: '2025-12', kind: 'summary' as const, levels: { ...jan.levels, sponsor: [] } };
    const r = runTile(tile({ x: 'sponsor' }), dash(), [imported, feb]);
    expect(r.notes.join(' ')).toContain('2025-12 has no sponsor numbers');
    expect(r.monthsUsed).toEqual(['2026-02']);
  });
});

describe('numbers (KPI)', () => {
  it('adds the measure over the months in the range, one number per measure', () => {
    const r = run(tile({ type: 'kpi', measures: ['OP_REVENUE', 'GROSS_PROFIT'] }));
    expect(r.categories.map((c) => c.label)).toEqual(['OP Revenue', 'Gross Profit']);
    expect(vals(r)).toEqual([37000, 37000 - 2000]);
  });

  it('compares the latest month with the previous month', () => {
    const r = run(tile({ type: 'kpi', compare: 'previousMonth' }));
    expect(vals(r)).toEqual([22000]);
    expect(r.compare).toMatchObject({ month: '2026-01' });
    expect(r.compare?.series[0]?.values).toEqual([15000]);
    expect(r.monthsUsed).toEqual(['2026-02']);
  });

  it('says so when the month to compare with is missing', () => {
    const r = run(tile({ type: 'kpi', compare: 'sameMonthLastYear' }));
    expect(r.compare).toBeNull();
    expect(r.notes.join(' ')).toContain('no Final month 2025-02');
  });
});

describe('compare on a chart by doctor', () => {
  it('lines the comparison month up with the categories, with gaps where a doctor had no row', () => {
    const r = run(tile({ x: 'doctor', compare: 'previousMonth' }));
    expect(labels(r)).toEqual(['A Kumar', 'B Rao', 'C Sen']); // February only
    expect(vals(r)).toEqual([15000, 5000, 2000]);
    expect(r.compare?.series[0]?.values).toEqual([10000, 5000, null]);
  });

  it('is ignored by month, with a note', () => {
    const r = run(tile({ compare: 'previousMonth' }));
    expect(r.compare).toBeNull();
    expect(r.notes.join(' ')).toMatch(/not by month/);
    expect(r.monthsUsed).toEqual(['2026-01', '2026-02']);
  });
});

describe('filter choices and the starter dashboards', () => {
  it('lists the names found in the Final months only', () => {
    const c = filterChoices(months);
    expect(c.doctors).toEqual(['A Kumar', 'B Rao', 'C Sen']);
    expect(c.departments).toEqual(['CARDIOLOGY', 'UROLOGY']);
    expect(c.sponsors).toEqual(['GENERAL', 'STAR']);
  });

  it('ships the five requested dashboards and Monthly Review, valid against the schema', () => {
    expect(STARTER_DASHBOARDS.map((d) => d.name)).toEqual([
      'Monthly Review',
      'Revenue by source',
      'Top 15 doctors by Gross Profit',
      'Department trend',
      'Sponsor mix',
      'Month vs previous variance',
    ]);
    expect(DashboardsFileSchema.safeParse({ version: 1, dashboards: STARTER_DASHBOARDS }).success).toBe(true);
    expect(starterDashboardsFile().dashboards).toHaveLength(6);
    expect(STARTER_DASHBOARDS[0]?.months).toEqual({ mode: 'latest' });
  });

  it('every starter tile can be calculated and draws something from the made-up history', () => {
    for (const d of STARTER_DASHBOARDS) {
      for (const data of runDashboard(d, months)) {
        expect(data.status, `${d.name}: ${data.tileId} ${data.message ?? ''}`).not.toBe('unsupported');
      }
    }
  });

  it('Revenue by source stacks IP, OP and pharmacy revenue by month', () => {
    const d = STARTER_DASHBOARDS.find((x) => x.id === 'revenue-by-source') as Dashboard;
    const r = runTile(d.tiles[0] as Tile, d, months);
    expect(r.series.map((s) => s.name)).toEqual(['IP Revenue', 'OP Revenue', 'OP Pharmacy']);
    expect(labels(r)).toEqual(['2026-01', '2026-02']);
  });
});
