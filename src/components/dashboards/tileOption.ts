// ECharts options for a dashboard tile. Pure, so it can be tested without a browser.

import type { EChartsCoreOption } from 'echarts/core';
import type { TileData } from '@/core/dashboard';
import type { Tile } from '@/core/schemas';
import { formatCompactINR, formatINR } from '@/core/money';

const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#4b5563', '#65a30d', '#ea580c'];

/** A number as the tile's unit: rupees (value in paise) or a plain count. */
export function showValue(unit: TileData['unit'], v: unknown, compact = false): string {
  if (typeof v !== 'number') return '';
  if (unit === 'count') return Number.isInteger(v) ? String(v) : v.toFixed(1);
  return compact ? formatCompactINR(Math.round(v)) : formatINR(Math.round(v));
}

export function tileOption(tile: Tile, data: TileData): EChartsCoreOption {
  const labels = data.categories.map((c) => c.label);
  const tooltipValue = (v: unknown) => showValue(data.unit, v);

  if (tile.type === 'pie') {
    const first = data.series[0];
    const slices = data.categories.flatMap((c, i) => {
      const value = first?.values[i];
      return typeof value === 'number' && value > 0 ? [{ name: c.label, value }] : []; // a pie cannot show a negative amount
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
  const longLabels = labels.length > 8 || labels.some((l) => l.length > 10);
  const kind = tile.type === 'line' ? 'line' : 'bar';
  const series = data.series.flatMap((s, i) => {
    const main = { name: s.name, type: kind, data: s.values, ...(stacked ? { stack: 'total' } : {}), ...(kind === 'line' ? { connectNulls: false, symbolSize: 7 } : {}) };
    const compare = data.compare?.series[i];
    return compare
      ? [main, { name: `${s.name} (${data.compare?.month})`, type: kind, data: compare.values, itemStyle: { opacity: 0.45 }, ...(kind === 'line' ? { lineStyle: { type: 'dashed' } } : {}) }]
      : [main];
  });

  return {
    animation: false,
    color: PALETTE,
    tooltip: { trigger: 'axis', valueFormatter: tooltipValue },
    legend: { type: 'scroll', top: 0 },
    grid: { left: 80, right: 24, top: 48, bottom: longLabels ? 84 : 36 },
    xAxis: { type: 'category', data: labels, boundaryGap: kind === 'bar', axisLabel: { interval: 0, rotate: longLabels ? 30 : 0, hideOverlap: true } },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => showValue(data.unit, v, true) } },
    series,
  };
}
