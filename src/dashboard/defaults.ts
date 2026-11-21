// The starter dashboard: "DRR Monthly Review", linked to the starter DRR recipe.

import type { DashboardTemplate } from './schema';

export const STARTER_DASHBOARD_ID = 'starter-drr-monthly-review';

export function starterDashboards(): DashboardTemplate[] {
  return [
    {
      schemaVersion: 1,
      id: STARTER_DASHBOARD_ID,
      name: 'DRR Monthly Review',
      recipeId: 'starter-drr',
      requiredColumns: ['Doctor Name', 'Department', 'Month', 'IP Revenue', 'OP Revenue', 'OP Pharmacy', 'Total Revenue', 'Gross Profit'],
      filters: [
        { column: 'Month', label: 'Month' },
        { column: 'Department', label: 'Department' },
      ],
      tiles: [
        { id: 'kpi-revenue', title: 'Total Revenue', type: 'kpi', y: { column: 'Total Revenue', agg: 'SUM' }, compare: { column: 'Month', mode: 'previous' } },
        { id: 'kpi-profit', title: 'Gross Profit', type: 'kpi', y: { column: 'Gross Profit', agg: 'SUM' }, compare: { column: 'Month', mode: 'previous' } },
        { id: 'bar-doctors', title: 'Top 15 doctors by Gross Profit', type: 'bar', x: 'Doctor Name', y: { column: 'Gross Profit', agg: 'SUM' }, topN: 15, sort: 'valueDesc' },
        {
          id: 'stack-dept',
          title: 'Revenue by department',
          type: 'stackedBar',
          x: 'Department',
          y: { column: 'IP Revenue', agg: 'SUM' },
          extraY: [
            { column: 'OP Revenue', agg: 'SUM' },
            { column: 'OP Pharmacy', agg: 'SUM' },
          ],
          sort: 'valueDesc',
        },
        { id: 'line-month', title: 'Total Revenue by Month', type: 'line', x: 'Month', y: { column: 'Total Revenue', agg: 'SUM' }, sort: 'label' },
        { id: 'table-change', title: 'Change on the previous month, by doctor', type: 'table', x: 'Doctor Name', y: { column: 'Total Revenue', agg: 'SUM' }, compare: { column: 'Month', mode: 'previous' }, sort: 'valueDesc' },
      ],
    },
  ];
}
