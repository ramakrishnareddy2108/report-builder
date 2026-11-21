// The dashboards every workspace starts with. They are saved to settings/dashboards.json the
// first time the Dashboards page opens, and can be edited or deleted like any other.

import { DashboardsFileSchema, SCHEMA_VERSION, type Dashboard, type DashboardsFile, type Tile } from './schemas';

const none = { doctors: [], departments: [], sponsors: [] };

function tile(id: string, title: string, over: Partial<Tile> & Pick<Tile, 'type' | 'measures'>): Tile {
  return {
    id,
    title,
    x: 'month',
    agg: 'sum',
    split: null,
    filters: none,
    topN: null,
    sort: 'desc',
    compare: 'none',
    ...over,
  };
}

const dashboard = (id: string, name: string, months: Dashboard['months'], tiles: Tile[]): Dashboard => ({
  id,
  name,
  months,
  departments: [],
  sponsors: [],
  tiles,
});

/** "Monthly Review" follows the newest Final month by itself. */
export const MONTHLY_REVIEW_ID = 'monthly-review';

export const STARTER_DASHBOARDS: readonly Dashboard[] = [
  dashboard(MONTHLY_REVIEW_ID, 'Monthly Review', { mode: 'latest' }, [
    tile('kpi-revenue', 'Total Revenue', { type: 'kpi', measures: ['TOTAL_REVENUE'], compare: 'previousMonth' }),
    tile('kpi-profit', 'Gross Profit', { type: 'kpi', measures: ['GROSS_PROFIT'], compare: 'previousMonth' }),
    tile('review-doctors', 'Top 10 doctors by Total Revenue', { type: 'bar', x: 'doctor', measures: ['TOTAL_REVENUE'], topN: 10 }),
    tile('review-sponsors', 'Sponsor mix', { type: 'pie', x: 'sponsor', measures: ['TOTAL_REVENUE'], topN: 8 }),
  ]),
  dashboard('revenue-by-source', 'Revenue by source', { mode: 'last', count: 12 }, [
    tile('sources-stacked', 'Revenue by source, by month', {
      type: 'stackedBar',
      measures: ['IP_REVENUE', 'OP_REVENUE', 'OP_PHARMACY'],
    }),
    tile('sources-table', 'Revenue by source, table', { type: 'table', measures: ['IP_REVENUE', 'OP_REVENUE', 'OP_PHARMACY', 'TOTAL_REVENUE'] }),
  ]),
  dashboard('top-doctors-profit', 'Top 15 doctors by Gross Profit', { mode: 'latest' }, [
    tile('doctors-profit', 'Top 15 doctors by Gross Profit', { type: 'bar', x: 'doctor', measures: ['GROSS_PROFIT'], topN: 15, compare: 'previousMonth' }),
    tile('doctors-profit-table', 'Top 15 doctors, table', { type: 'table', x: 'doctor', measures: ['TOTAL_REVENUE', 'GROSS_PROFIT'], topN: 15 }),
  ]),
  dashboard('department-trend', 'Department trend', { mode: 'last', count: 12 }, [
    tile('dept-trend', 'Total Revenue by department', { type: 'line', measures: ['TOTAL_REVENUE'], split: 'department' }),
    tile('dept-profit', 'Gross Profit by department', { type: 'line', measures: ['GROSS_PROFIT'], split: 'department' }),
  ]),
  dashboard('sponsor-mix', 'Sponsor mix', { mode: 'latest' }, [
    tile('sponsor-pie', 'Total Revenue by sponsor', { type: 'pie', x: 'sponsor', measures: ['TOTAL_REVENUE'], topN: 10 }),
    tile('sponsor-table', 'Sponsors against the previous month', { type: 'table', x: 'sponsor', measures: ['TOTAL_REVENUE'], topN: 15, compare: 'previousMonth' }),
  ]),
  dashboard('variance', 'Month vs previous variance', { mode: 'latest' }, [
    tile('var-revenue', 'Total Revenue', { type: 'kpi', measures: ['TOTAL_REVENUE'], compare: 'previousMonth' }),
    tile('var-op', 'OP Revenue', { type: 'kpi', measures: ['OP_REVENUE'], compare: 'previousMonth' }),
    tile('var-ip', 'IP Revenue', { type: 'kpi', measures: ['IP_REVENUE'], compare: 'previousMonth' }),
    tile('var-profit', 'Gross Profit', { type: 'kpi', measures: ['GROSS_PROFIT'], compare: 'previousMonth' }),
    tile('var-doctors', 'Doctors: Total Revenue against the previous month', {
      type: 'table',
      x: 'doctor',
      measures: ['TOTAL_REVENUE'],
      compare: 'previousMonth',
    }),
    tile('var-year', 'Doctors: Total Revenue against the same month last year', {
      type: 'table',
      x: 'doctor',
      measures: ['TOTAL_REVENUE'],
      compare: 'sameMonthLastYear',
      topN: 15,
    }),
  ]),
];

/** The file written the first time. A fresh copy each call. */
export function starterDashboardsFile(): DashboardsFile {
  return DashboardsFileSchema.parse({ version: SCHEMA_VERSION, dashboards: structuredClone(STARTER_DASHBOARDS) });
}
