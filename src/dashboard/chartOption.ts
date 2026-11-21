// ECharts options for a chart tile. Pure, so it can be tested without a browser.

import type { EChartsCoreOption } from 'echarts/core';
import { formatCompactINR, formatINR } from '@/core/money';
import type { Tile } from './schema';
import type { Format, TileResult } from './tiles';

const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#4b5563', '#65a30d', '#ea580c', '#0d9488', '#9333ea'];

const rupeesToPaise = (v: number) => Math.round(Number((v * 100).toPrecision(15)));

/** A value for display: rupees in the Indian style, other numbers with grouping; `compact` is for axes. */
export function formatValue(format: Format | 'percent', v: unknown, compact = false): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  if (format === 'percent') return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  if (format === 'money') return compact ? formatCompactINR(rupeesToPaise(v)) : formatINR(rupeesToPaise(v));
  return Number.isInteger(v) ? v.toLocaleString('en-IN') : v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

type Chart = Extract<TileResult, { kind: 'chart' }>;

export function chartOption(tile: Tile, r: Chart): EChartsCoreOption {
  const tooltipValue = (v: unknown) => formatValue(r.format, v);

  if (tile.type === 'pie') {
    const first = r.series[0];
    const slices = r.categories.flatMap((c, i) => {
      const value = first?.values[i];
      return typeof value === 'number' && value > 0 ? [{ name: c, value }] : []; // a pie cannot show zero or a negative amount
    });
    return {
      animation: false,
      color: PALETTE,
      tooltip: { trigger: 'item', valueFormatter: tooltipValue },
      legend: { type: 'scroll', bottom: 0 },
      series: [{ type: 'pie', radius: ['35%', '68%'], center: ['50%', '45%'], data: slices, label: { formatter: '{b}: {d}%' } }],
    };
  }

  const stacked = tile.type === 'stackedBar';
  const kind = tile.type === 'line' ? 'line' : 'bar';
  const longLabels = r.categories.length > 8 || r.categories.some((l) => l.length > 10);
  return {
    animation: false,
    color: PALETTE,
    tooltip: { trigger: 'axis', valueFormatter: tooltipValue },
    legend: { type: 'scroll', top: 0 },
    grid: { left: 8, right: 16, top: r.series.length > 1 ? 44 : 24, bottom: longLabels ? 8 : 4, containLabel: true },
    xAxis: { type: 'category', data: r.categories, boundaryGap: kind === 'bar', axisLabel: { interval: 0, rotate: longLabels ? 35 : 0, hideOverlap: true } },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatValue(r.format, v, true) } },
    series: r.series.map((s) => ({
      name: s.name,
      type: kind,
      data: s.values,
      ...(stacked ? { stack: 'total' } : {}),
      ...(kind === 'line' ? { connectNulls: false, symbolSize: 7 } : {}),
    })),
  };
}
