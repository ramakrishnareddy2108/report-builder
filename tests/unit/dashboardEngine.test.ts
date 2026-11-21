import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { chartOption, formatValue } from '@/dashboard/chartOption';
import { dataFromReport, missingColumns, periodFromFileName, readOutputFile, stackData, type DashboardData } from '@/dashboard/data';
import { starterDashboards } from '@/dashboard/defaults';
import { DashboardTemplateSchema, type Tile } from '@/dashboard/schema';
import { computeTile, filterValues, monthKey, orderPeriods, tileColumns } from '@/dashboard/tiles';
import { generate } from '@/engine/generate';
import { openWorkbook } from '@/excel/readWorkbook';
import { files, PARAMS, recipe } from '../helpers/syntheticRecipe';

const data = (rows: Record<string, string | number | null>[]): DashboardData => ({
  columns: [
    { name: 'Month', type: 'text' },
    { name: 'Doctor', type: 'text' },
    { name: 'Department', type: 'text' },
    { name: 'Revenue', type: 'money' },
    { name: 'Count', type: 'number' },
  ],
  rows,
  sources: [],
});

const ROWS = [
  { Month: 'Sep-2026', Doctor: 'A', Department: 'Cardio', Revenue: 100.1, Count: 2 },
  { Month: 'Sep-2026', Doctor: 'B', Department: 'Neuro', Revenue: 50, Count: 1 },
  { Month: 'Oct-2026', Doctor: 'A', Department: 'Cardio', Revenue: 150.2, Count: 3 },
  { Month: 'Oct-2026', Doctor: 'B', Department: 'Neuro', Revenue: 20, Count: 1 },
  { Month: 'Oct-2026', Doctor: 'C', Department: 'Cardio', Revenue: 0.1, Count: 0 },
  { Month: 'Oct-2026', Doctor: 'C', Department: 'Cardio', Revenue: 0.2, Count: 0 },
];
const D = data(ROWS);
const tile = (t: Partial<Tile> & Pick<Tile, 'type'>): Tile => ({ id: 't', title: 'T', y: { column: 'Revenue', agg: 'SUM' }, ...t });

describe('months and periods', () => {
  it('reads month labels in several forms', () => {
    expect(monthKey('Oct-2026')).toBe('2026-10');
    expect(monthKey('October 2026')).toBe('2026-10');
    expect(monthKey('Oct-26')).toBe('2026-10');
    expect(monthKey('2026-10')).toBe('2026-10');
    expect(monthKey('Q2')).toBeNull();
    expect(monthKey('Foo-2026')).toBeNull();
  });

  it('orders months by the calendar, and other periods naturally', () => {
    expect(orderPeriods(['Jan-2027', 'Oct-2026', 'Sep-2026', 'Oct-2026'])).toEqual(['Sep-2026', 'Oct-2026', 'Jan-2027']);
    expect(orderPeriods(['File 10', 'File 2', 'File 1'])).toEqual(['File 1', 'File 2', 'File 10']);
  });
});

describe('KPI tiles', () => {
  it('sums money exactly (0.1 + 0.2 is 0.3), and compares with the previous period', () => {
    const r = computeTile(tile({ type: 'kpi', compare: { column: 'Month', mode: 'previous' } }), D);
    expect(r).toMatchObject({ status: 'ok', kind: 'kpi', value: 170.5, previous: 150.1, change: 20.4, period: { latest: 'Oct-2026', previous: 'Sep-2026' }, format: 'money' });
    expect((r as { changePct: number }).changePct).toBeCloseTo(13.59, 1);
    const all = computeTile(tile({ type: 'kpi' }), D);
    expect(all).toMatchObject({ kind: 'kpi', value: 320.6, change: null, period: null });
  });

  it('with only one period there is nothing to compare, and it says so', () => {
    const r = computeTile(tile({ type: 'kpi', compare: { column: 'Month', mode: 'previous' } }), data(ROWS.slice(2)));
    expect(r).toMatchObject({ kind: 'kpi', change: null });
    expect((r as { notes: string[] }).notes[0]).toMatch(/Only one Month is loaded/);
  });

  it('counts, averages, smallest and largest', () => {
    const v = (agg: 'COUNT' | 'AVG' | 'MIN' | 'MAX') => (computeTile(tile({ type: 'kpi', y: { column: 'Revenue', agg } }), D) as { value: number }).value;
    expect(v('COUNT')).toBe(6);
    expect(v('AVG')).toBe(53.43); // 32060 paise / 6 = 5343.33 → 5343 paise
    expect(v('MIN')).toBe(0.1);
    expect(v('MAX')).toBe(150.2);
  });
});

describe('chart tiles', () => {
  it('bar: groups, sorts by value, and keeps the top N with a note', () => {
    const r = computeTile(tile({ type: 'bar', x: 'Doctor', topN: 2, sort: 'valueDesc' }), D);
    expect(r).toMatchObject({ kind: 'chart', categories: ['A', 'B'], format: 'money' });
    expect((r as { series: { values: number[] }[] }).series[0]?.values).toEqual([250.3, 70]);
    expect((r as { notes: string[] }).notes).toEqual(['Showing the top 2 of 3.']);
  });

  it('line: months in calendar order, whatever order the rows come in', () => {
    const r = computeTile(tile({ type: 'line', x: 'Month', sort: 'label' }), data([...ROWS].reverse()));
    expect((r as { categories: string[] }).categories).toEqual(['Sep-2026', 'Oct-2026']);
    expect((r as { series: { values: number[] }[] }).series[0]?.values).toEqual([150.1, 170.5]);
  });

  it('stacked bar: several measures become series', () => {
    const d2: DashboardData = { ...D, columns: [...D.columns, { name: 'Other', type: 'money' }], rows: ROWS.map((r) => ({ ...r, Other: 1 })) };
    const r = computeTile(tile({ type: 'stackedBar', x: 'Department', extraY: [{ column: 'Other', agg: 'SUM' }] }), d2);
    expect((r as { series: { name: string; values: number[] }[] }).series.map((s) => [s.name, s.values])).toEqual([
      ['Revenue', [320.6 - 70, 70].map((n) => Number(n.toFixed(2)))],
      ['Other', [4, 2]],
    ]);
    expect(chartOption(tile({ type: 'stackedBar' }), r as never)).toMatchObject({ series: [{ stack: 'total' }, { stack: 'total' }] });
  });

  it('split by: one series per value; the smaller ones beyond twelve are noted, not hidden', () => {
    const many = data(Array.from({ length: 15 }, (_, i) => ({ Month: 'Oct-2026', Doctor: `D${i}`, Department: 'X', Revenue: i + 1, Count: 1 })));
    const r = computeTile(tile({ type: 'bar', x: 'Department', splitBy: 'Doctor' }), many) as { series: unknown[]; notes: string[] };
    expect(r.series).toHaveLength(12);
    expect(r.notes[0]).toBe('3 smaller Doctor values are not drawn (the largest 12 are).');
    expect(computeTile(tile({ type: 'bar', x: 'Department', splitBy: 'Doctor', extraY: [{ column: 'Count', agg: 'SUM' }] }), many)).toMatchObject({ status: 'error' });
  });

  it('compare on a bar: the previous and latest period side by side', () => {
    const r = computeTile(tile({ type: 'bar', x: 'Doctor', sort: 'label', compare: { column: 'Month', mode: 'previous' } }), D) as { series: { name: string; values: (number | null)[] }[] };
    expect(r.series.map((s) => s.name)).toEqual(['Sep-2026', 'Oct-2026']);
    expect(r.series[0]?.values).toEqual([100.1, 50, null]);
    expect(r.series[1]?.values).toEqual([150.2, 20, 0.3]);
  });

  it('pie: negative amounts are counted in a note, not drawn', () => {
    const r = computeTile(tile({ type: 'pie', x: 'Doctor' }), data([...ROWS, { Month: 'Oct-2026', Doctor: 'Z', Department: 'X', Revenue: -5, Count: 1 }])) as { notes: string[] };
    expect(r.notes).toContain('1 negative value cannot be drawn in a pie and is left out.');
  });
});

describe('table tiles', () => {
  it('shows latest, previous, change and change % per row', () => {
    const r = computeTile(tile({ type: 'table', x: 'Doctor', compare: { column: 'Month', mode: 'previous' }, sort: 'valueDesc' }), D) as { columns: { label: string }[]; rows: Record<string, number | string | null>[] };
    expect(r.columns.map((c) => c.label)).toEqual(['Doctor', 'Oct-2026', 'Sep-2026', 'Change', 'Change %']);
    expect(r.rows[0]).toMatchObject({ x: 'A', latest: 150.2, previous: 100.1, change: 50.1 });
    expect(r.rows.find((x) => x.x === 'B')).toMatchObject({ latest: 20, previous: 50, change: -30, pct: -60 });
    expect(r.rows.find((x) => x.x === 'C')).toMatchObject({ latest: 0.3, previous: null, change: 0.3, pct: null }); // new in Oct
  });

  it('without a comparison it lists the measures; split by makes a column per value', () => {
    const plain = computeTile(tile({ type: 'table', x: 'Doctor', extraY: [{ column: 'Count', agg: 'SUM' }], sort: 'label' }), D) as { columns: { label: string }[]; rows: Record<string, unknown>[] };
    expect(plain.columns.map((c) => c.label)).toEqual(['Doctor', 'Revenue', 'Count']);
    expect(plain.rows[0]).toMatchObject({ x: 'A', Revenue: 250.3, Count: 5 });
    const pivot = computeTile(tile({ type: 'table', x: 'Doctor', splitBy: 'Month', sort: 'label' }), D) as { columns: { label: string }[] };
    expect(pivot.columns.map((c) => c.label)).toEqual(['Doctor', 'Oct-2026', 'Sep-2026']);
  });
});

describe('filters and problems', () => {
  it('global filters narrow the rows; the tile filter is a formula, and rows it cannot judge are counted', () => {
    expect((computeTile(tile({ type: 'kpi' }), D, { Department: ['Neuro'] }) as { value: number }).value).toBe(70);
    expect((computeTile(tile({ type: 'kpi', filter: '[Revenue] > 100' }), D) as { value: number }).value).toBe(250.3);
    expect((computeTile(tile({ type: 'kpi', filter: '[Doctor] = "a"' }), D) as { value: number }).value).toBe(250.3); // text comparison ignores case
    const bad = computeTile(tile({ type: 'kpi', filter: '[Revenue] / [Count] > 1' }), D) as { notes: string[] };
    expect(bad.notes[0]).toBe('2 rows could not be judged by the tile\'s filter and were left out.');
    expect(computeTile(tile({ type: 'kpi', filter: '[Revenue] >' }), D)).toMatchObject({ status: 'error' });
    expect(computeTile(tile({ type: 'kpi' }), D, { Department: ['Nowhere'] })).toMatchObject({ status: 'empty', message: 'No rows match the filters.' });
  });

  it('a missing column, a missing X and an empty data set are plain messages', () => {
    expect(computeTile(tile({ type: 'bar', x: 'Nope' }), D)).toEqual({ status: 'error', message: 'The loaded data has no column “Nope”. Pick another column, or load the right report files.' });
    expect(computeTile(tile({ type: 'bar' }), D)).toMatchObject({ status: 'error', message: expect.stringContaining('Choose what to group by') });
    expect(computeTile(tile({ type: 'kpi' }), data([]))).toMatchObject({ status: 'empty' });
  });

  it('lists the columns a tile uses, and the values for a filter drop-down', () => {
    expect(tileColumns(tile({ type: 'bar', x: 'Doctor', splitBy: 'Department', compare: { column: 'Month', mode: 'previous' }, extraY: [{ column: 'Count', agg: 'SUM' }] }))).toEqual(['Doctor', 'Revenue', 'Count', 'Department', 'Month']);
    expect(filterValues(D, 'Month')).toEqual(['Sep-2026', 'Oct-2026']);
    expect(filterValues(D, 'Doctor')).toEqual(['A', 'B', 'C']);
  });
});

describe('formatting', () => {
  it('shows rupees in the Indian style, counts with grouping and changes with a sign', () => {
    expect(formatValue('money', 1234567.5)).toBe('₹12,34,567.50');
    expect(formatValue('money', 12500000, true)).toBe('₹1.25 Cr');
    expect(formatValue('number', 1234567)).toBe('12,34,567');
    expect(formatValue('percent', 13.59)).toBe('+13.6%');
    expect(formatValue('percent', -4)).toBe('-4.0%');
    expect(formatValue('money', null)).toBe('');
  });
});

// ---- loading data -----------------------------------------------------------------------------

describe('dashboard data', () => {
  it('takes the report of this session: rupees, no serial column, the period added when there is no Month', () => {
    const d = dataFromReport({
      recipeName: 'R',
      period: 'Oct-2026',
      columns: [{ name: 'S.No.', type: 'number', kind: 'serial' }, { name: 'Doctor', type: 'text', kind: 'group' }, { name: 'Revenue', type: 'money', kind: 'aggregate' }],
      rows: [{ 'S.No.': 1, Doctor: 'A', Revenue: 12345 }],
    });
    expect(d.columns.map((c) => c.name)).toEqual(['Doctor', 'Revenue', 'Month', '_file']);
    expect(d.rows).toEqual([{ Doctor: 'A', Revenue: 123.45, Month: 'Oct-2026', _file: 'Last generated report' }]);
  });

  async function reportBytes(mode: 'plain' | 'template'): Promise<Uint8Array> {
    const r = recipe();
    if (mode === 'template') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Report');
      ws.getCell('F2').value = { formula: 'SUBTOTAL(9,F5:F20)', result: 0 };
      ['S.No.', 'Doctor Name', 'Department', 'Month', 'OP Revenue', 'OP Pharmacy', 'Total Revenue', 'OP Pharmacy Cost', 'Salary Cost', 'Gross Profit'].forEach((h, i) => (ws.getRow(4).getCell(i + 1).value = h));
      const { bytesToBase64 } = await import('@/lib/base64');
      r.output = { mode: 'template', templateName: 't', templateBase64: bytesToBase64(new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer)), headerRow: 4, keepTemplateFormulas: true, includeChecksSheet: true, includeCombinedSheet: false };
    } else {
      r.output = { mode: 'plain', sheetName: 'DRR', includeChecksSheet: true, includeCombinedSheet: true };
    }
    const out = await generate({ recipe: r, params: PARAMS, files: files().map((f) => ({ sourceId: f.sourceId, fileName: f.fileName, workbook: openWorkbook(f.bytes) })) });
    return out.workbookBytes as Uint8Array;
  }

  it('reads a saved plain report: finds the table, skips the totals row, adds the file, types from the recipe', () => {
    return reportBytes('plain').then((bytes) => {
      const d = readOutputFile(bytes, { fileName: 'DRR_Oct-2026.xlsx', recipe: recipe() });
      expect(d.sources).toEqual([{ name: 'DRR_Oct-2026.xlsx', rows: 3, skipped: 1, period: 'Oct-2026' }]);
      expect(d.columns.map((c) => [c.name, c.type])).toEqual([
        ['Doctor Name', 'text'], ['Department', 'text'], ['Month', 'text'], ['OP Revenue', 'money'], ['OP Pharmacy', 'money'], ['Total Revenue', 'money'], ['OP Pharmacy Cost', 'money'], ['Salary Cost', 'money'], ['Gross Profit', 'money'], ['_file', 'text'],
      ]);
      expect(d.rows[0]).toMatchObject({ 'Doctor Name': 'Dr A Kumar', Month: 'Oct-2026', 'Total Revenue': 1650.25, 'Gross Profit': -3429.8, _file: 'DRR_Oct-2026.xlsx' });
      expect(d.rows.every((r) => r['Doctor Name'] !== 'Total')).toBe(true);
    });
  });

  it('reads a filled template (title rows above the table, header on row 4) and guesses types without a recipe', async () => {
    const d = readOutputFile(await reportBytes('template'), { fileName: 'x.xlsx' });
    expect(d.rows).toHaveLength(3);
    expect(d.columns.find((c) => c.name === 'Gross Profit')?.type).toBe('money');
    expect(d.columns.find((c) => c.name === 'Doctor Name')?.type).toBe('text');
    expect(d.rows[1]).toMatchObject({ 'Doctor Name': 'Dr B Rao', 'OP Revenue': 2000 });
  });

  it('a file without a Month column gets its file name as the period; several files stack', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.addRow(['Doctor', 'Revenue']);
    ws.addRow(['A', 10.5]);
    ws.addRow(['Total', 10.5]);
    const bytes = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const a = readOutputFile(bytes, { fileName: 'DRR Sep 2026.xlsx' });
    const b = readOutputFile(bytes, { fileName: 'DRR Oct 2026.xlsx' });
    expect(a.rows).toEqual([{ Doctor: 'A', Revenue: 10.5, Month: 'DRR Sep 2026', _file: 'DRR Sep 2026.xlsx' }]);
    const stacked = stackData([a, b]);
    expect(stacked.rows.map((r) => r.Month)).toEqual(['DRR Sep 2026', 'DRR Oct 2026']);
    expect(stacked.sources).toHaveLength(2);
    expect(periodFromFileName('DRR_Oct-2026.xlsx')).toBe('DRR_Oct-2026');
  });

  it('a file with no table is reported, not skipped silently', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Empty');
    const none = readOutputFile(new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer), { fileName: 'empty.xlsx' });
    expect(none.rows).toEqual([]);
    expect(none.sources[0]?.message).toBe('The file has no data.');

    const nums = new ExcelJS.Workbook();
    nums.addWorksheet('N').addRow([1, 2, 3]);
    expect(readOutputFile(new Uint8Array((await nums.xlsx.writeBuffer()) as ArrayBuffer), { fileName: 'n.xlsx' }).sources[0]?.message).toBe('No table with column headings was found in this file.');
  });

  it('checks the required columns against the loaded data', () => {
    expect(missingColumns(['Doctor', 'gross profit', 'Nope'], { ...D, columns: [{ name: 'Doctor', type: 'text' }, { name: 'Gross Profit', type: 'money' }] })).toEqual(['Nope']);
  });
});

describe('starter dashboard', () => {
  const [dash] = starterDashboards();
  it('is a valid template with the six tiles of the plan, linked to the DRR recipe', () => {
    expect(DashboardTemplateSchema.safeParse(dash).success).toBe(true);
    expect(dash?.recipeId).toBe('starter-drr');
    expect(dash?.tiles.map((t) => t.type)).toEqual(['kpi', 'kpi', 'bar', 'stackedBar', 'line', 'table']);
    expect(dash?.tiles[2]).toMatchObject({ x: 'Doctor Name', topN: 15 });
  });

  it('shows changes when two months are loaded (the October report twice, one edited to September)', () => {
    const oct = dataFromReport({
      recipeName: 'DRR', period: 'Oct-2026',
      columns: [{ name: 'Doctor Name', type: 'text', kind: 'group' }, { name: 'Department', type: 'text', kind: 'group' }, { name: 'Month', type: 'text', kind: 'group' }, { name: 'Total Revenue', type: 'money', kind: 'formula' }, { name: 'Gross Profit', type: 'money', kind: 'formula' }, { name: 'IP Revenue', type: 'money', kind: 'aggregate' }, { name: 'OP Revenue', type: 'money', kind: 'aggregate' }, { name: 'OP Pharmacy', type: 'money', kind: 'aggregate' }],
      rows: [{ 'Doctor Name': 'A', Department: 'X', Month: 'Oct-2026', 'Total Revenue': 20000, 'Gross Profit': 5000, 'IP Revenue': 10000, 'OP Revenue': 6000, 'OP Pharmacy': 4000 }],
    });
    const sep = { ...oct, rows: oct.rows.map((r) => ({ ...r, Month: 'Sep-2026', 'Total Revenue': 150 })) }; // rupees
    const both = stackData([sep, oct]);
    expect(missingColumns(dash?.requiredColumns ?? [], both)).toEqual([]);
    const kpi = computeTile(dash!.tiles[0]!, both) as { value: number; previous: number; change: number; changePct: number };
    expect(kpi).toMatchObject({ value: 200, previous: 150, change: 50 });
    expect(kpi.changePct).toBeCloseTo(33.33, 1);
    const table = computeTile(dash!.tiles[5]!, both) as unknown as { rows: { change: number }[] };
    expect(table.rows[0]?.change).toBe(50);
    for (const t of dash!.tiles) expect(computeTile(t, both).status, t.title).toBe('ok');
  });
});
