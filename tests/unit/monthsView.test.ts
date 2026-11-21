import { describe, expect, it } from 'vitest';
import { trendOption } from '@/components/months/trendOption';
import { compareMonths, type GroupRow } from '@/core/history';
import { MEASURE_CODES } from '@/core/types';
import { buildCompareWorkbook } from '@/excel/compareSheet';
import { reopen } from '../helpers/syntheticTemplate';

const row = (key: string, name: string, over: Partial<GroupRow['values']> = {}): GroupRow => ({
  key,
  name,
  values: { ...Object.fromEntries(MEASURE_CODES.map((k) => [k, 0])), ...over } as GroupRow['values'],
});

describe('trendOption', () => {
  const option = trendOption(
    { months: ['2026-01', '2026-02'], series: [{ name: 'Alpha', points: [1250000000, null] }, { name: 'Beta', points: [100, 200] }] },
    'TOTAL_REVENUE',
  ) as {
    xAxis: { data: string[] };
    series: { name: string; data: (number | null)[]; type: string }[];
    yAxis: { axisLabel: { formatter: (v: number) => string } };
    tooltip: { valueFormatter: (v: unknown) => string };
  };

  it('has one line per series over the months, with gaps kept as gaps', () => {
    expect(option.xAxis.data).toEqual(['2026-01', '2026-02']);
    expect(option.series.map((s) => [s.name, s.type])).toEqual([['Alpha', 'line'], ['Beta', 'line']]);
    expect(option.series[0]?.data).toEqual([1250000000, null]);
  });

  it('writes amounts in rupees: short on the axis, in full in the tooltip', () => {
    expect(option.yAxis.axisLabel.formatter(1250000000)).toBe('₹1.25 Cr');
    expect(option.tooltip.valueFormatter(1234500)).toBe('₹12,345.00');
    expect(option.tooltip.valueFormatter(null)).toBe('');
  });

  it('writes a count as a plain number', () => {
    const counts = trendOption({ months: ['2026-01'], series: [{ name: 'All', points: [42] }] }, 'IP_COUNT') as typeof option;
    expect(counts.yAxis.axisLabel.formatter(42)).toBe('42');
    expect(counts.tooltip.valueFormatter(42)).toBe('42');
  });
});

describe('buildCompareWorkbook', () => {
  it('has A, B, change and change % per measure, in rupees, and leaves a missing month blank', async () => {
    const rows = compareMonths(
      [row('A', 'Alpha', { OP_REVENUE: 150050, IP_COUNT: 3 }), row('N', '=NEW', { OP_REVENUE: 700 })],
      [row('A', 'Alpha', { OP_REVENUE: 100000, IP_COUNT: 2 })],
    );
    const bytes = await buildCompareWorkbook({ monthA: '2026-10', monthB: '2026-09', level: 'doctor', measures: ['IP_COUNT', 'OP_REVENUE'], rows });
    const ws = (await reopen(bytes)).getWorksheet('Compare')!;

    expect(ws.getRow(1).getCell(1).value).toContain('2026-10 (A) against 2026-09 (B)');
    expect((ws.getRow(2).values as unknown[]).slice(1)).toEqual([
      'Doctor', 'IP Count A', 'IP Count B', 'IP Count change', 'IP Count change %',
      'OP Revenue A', 'OP Revenue B', 'OP Revenue change', 'OP Revenue change %',
    ]);
    // Rows are sorted by name, so the text that starts with "=" comes first.
    const added = ws.getRow(3);
    expect(added.getCell(1).value).toBe("'=NEW"); // text is escaped
    expect(added.getCell(3).value).toBeNull(); // not in month B
    expect(added.getCell(6).value).toBe(7); // OP revenue A in rupees
    expect(added.getCell(7).value).toBeNull();
    expect(added.getCell(9).value).toBeNull(); // no percent without a B
    const alpha = ws.getRow(4);
    expect((alpha.values as unknown[]).slice(1)).toEqual(['Alpha', 3, 2, 1, 50, 1500.5, 1000, 500.5, 50.1]);
  });
});
