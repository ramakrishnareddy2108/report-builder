// The ECharts options for the trend line chart. Pure, so it can be tested without a browser.

import type { EChartsCoreOption } from 'echarts/core';
import { getMeasure } from '@/core/measures';
import { formatCompactINR, formatINR } from '@/core/money';
import type { Trend } from '@/core/history';
import type { MeasureCode } from '@/core/types';

const show = (code: MeasureCode, v: number | null | undefined, compact: boolean): string => {
  if (v === null || v === undefined) return '';
  if (getMeasure(code).kind === 'count') return String(v);
  return compact ? formatCompactINR(v) : formatINR(v);
};

export function trendOption(trend: Trend, code: MeasureCode): EChartsCoreOption {
  return {
    animation: false,
    color: ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#4b5563'],
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v: unknown) => show(code, typeof v === 'number' ? v : null, false),
    },
    legend: { type: 'scroll', top: 0 },
    grid: { left: 80, right: 24, top: 48, bottom: 32 },
    xAxis: { type: 'category', data: trend.months, boundaryGap: false },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => show(code, v, true) } },
    series: trend.series.map((s) => ({
      name: s.name,
      type: 'line',
      data: s.points,
      connectNulls: false,
      showSymbol: trend.months.length <= 24,
      symbolSize: 7,
    })),
  };
}
