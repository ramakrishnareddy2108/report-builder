import { describe, expect, it } from 'vitest';
import { showValue, tileOption } from '@/components/dashboards/tileOption';
import type { TileData } from '@/core/dashboard';
import { tileTable } from '@/core/dashboardTable';
import type { Tile } from '@/core/schemas';
import { buildTableWorkbook } from '@/excel/tableSheet';
import { reopen } from '../helpers/syntheticTemplate';

const tile = (over: Partial<Tile> = {}): Tile => ({
  id: 't', title: 'T', type: 'bar', x: 'doctor', measures: ['TOTAL_REVENUE'], agg: 'sum', split: null,
  filters: { doctors: [], departments: [], sponsors: [] }, topN: null, sort: 'desc', compare: 'none', ...over,
});

const data = (over: Partial<TileData> = {}): TileData => ({
  tileId: 't', status: 'ok', message: null, notes: [], unit: 'money',
  categories: [{ key: 'A', label: 'A Kumar' }, { key: 'B', label: 'B Rao' }],
  series: [{ name: 'Total Revenue', values: [1500000, 500000] }],
  compare: null, monthsUsed: ['2026-02'], ...over,
});

type Opt = {
  xAxis: { data: string[] };
  yAxis: { axisLabel: { formatter: (v: number) => string } };
  tooltip: { valueFormatter: (v: unknown) => string };
  series: { name?: string; type: string; data: unknown; stack?: string; lineStyle?: unknown }[];
};

describe('showValue', () => {
  it('writes rupees from paise, short on an axis, and counts as numbers', () => {
    expect(showValue('money', 1234500)).toBe('₹12,345.00');
    expect(showValue('money', 1250000000, true)).toBe('₹1.25 Cr');
    expect(showValue('count', 7)).toBe('7');
    expect(showValue('count', 2.5)).toBe('2.5');
    expect(showValue('money', null)).toBe('');
  });
});

describe('tileOption', () => {
  it('a bar chart has the categories on the axis and one series per measure', () => {
    const o = tileOption(tile(), data()) as Opt;
    expect(o.xAxis.data).toEqual(['A Kumar', 'B Rao']);
    expect(o.series).toEqual([{ name: 'Total Revenue', type: 'bar', data: [1500000, 500000] }]);
    expect(o.tooltip.valueFormatter(1500000)).toBe('₹15,000.00');
    expect(o.yAxis.axisLabel.formatter(1500000)).toBe('₹15,000');
  });

  it('a stacked bar stacks, and a line chart draws lines', () => {
    expect((tileOption(tile({ type: 'stackedBar' }), data()) as Opt).series[0]?.stack).toBe('total');
    expect((tileOption(tile({ type: 'line', x: 'month' }), data()) as Opt).series[0]?.type).toBe('line');
  });

  it('adds the comparison month as a lighter second series', () => {
    const d = data({ compare: { month: '2026-01', series: [{ name: 'Total Revenue', values: [1000000, null] }] } });
    const o = tileOption(tile(), d) as Opt;
    expect(o.series.map((s) => s.name)).toEqual(['Total Revenue', 'Total Revenue (2026-01)']);
    expect(o.series[1]?.data).toEqual([1000000, null]);
  });

  it('a pie shows the positive amounts as slices and leaves out the rest', () => {
    const d = data({ categories: [{ key: 'A', label: 'A' }, { key: 'B', label: 'B' }, { key: 'C', label: 'C' }], series: [{ name: 'x', values: [300, -50, null] }] });
    const o = tileOption(tile({ type: 'pie' }), d) as { series: { data: { name: string; value: number }[] }[] };
    expect(o.series[0]?.data).toEqual([{ name: 'A', value: 300 }]);
  });
});

describe('tileTable', () => {
  it('has a row per category and a column per series', () => {
    const t = tileTable(tile(), data());
    expect(t.columns.map((c) => c.header)).toEqual(['Doctor', 'Total Revenue']);
    expect(t.rows).toEqual([['A Kumar', 1500000], ['B Rao', 500000]]);
  });

  it('adds the comparison month, the change and the change percent beside each series', () => {
    const d = data({ compare: { month: '2026-01', series: [{ name: 'Total Revenue', values: [1000000, null] }] } });
    const t = tileTable(tile(), d);
    expect(t.columns.map((c) => c.header)).toEqual(['Doctor', 'Total Revenue (2026-02)', 'Total Revenue (2026-01)', 'Total Revenue change', 'Total Revenue change %']);
    expect(t.rows[0]).toEqual(['A Kumar', 1500000, 1000000, 500000, 50]);
    expect(t.rows[1]).toEqual(['B Rao', 500000, null, 500000, null]); // no percent without a previous value
  });

  it('counts stay counts', () => {
    expect(tileTable(tile(), data({ unit: 'count' })).columns[1]?.kind).toBe('count');
  });
});

describe('table export', () => {
  it('writes money in rupees, keeps counts, escapes text, and leaves blanks blank', async () => {
    const t = tileTable(tile(), data({ categories: [{ key: 'A', label: '=Dr A' }, { key: 'B', label: 'B Rao' }], series: [{ name: 'Total Revenue', values: [1500050, null] }] }));
    const ws = (await reopen(await buildTableWorkbook({ title: 'Top doctors', table: t }))).getWorksheet('Data')!;
    expect(ws.getRow(1).getCell(1).value).toBe('Top doctors');
    expect((ws.getRow(2).values as unknown[]).slice(1)).toEqual(['Doctor', 'Total Revenue']);
    expect(ws.getRow(3).getCell(1).value).toBe("'=Dr A");
    expect(ws.getRow(3).getCell(2).value).toBe(15000.5);
    expect(ws.getRow(4).getCell(2).value).toBeNull();
  });
});
