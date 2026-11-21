import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { useSession } from '@/app/sessionStore';
import { tileToTable } from '@/dashboard/export';
import { starterDashboards } from '@/dashboard/defaults';
import type { DashboardData } from '@/dashboard/data';
import type { Tile } from '@/dashboard/schema';
import { computeTile } from '@/dashboard/tiles';
import { blankDashboard } from '@/recipe/blank';
import { columnsUsed, useDash } from '@/pages/Dashboards/dashStore';
import { exportTableTask, readOutputsTask } from '@/worker/tasks/dashboardTasks';

const data: DashboardData = {
  columns: [
    { name: 'Month', type: 'text' },
    { name: 'Doctor', type: 'text' },
    { name: 'Revenue', type: 'money' },
  ],
  rows: [
    { Month: 'Sep-2026', Doctor: 'A', Revenue: 100 },
    { Month: 'Oct-2026', Doctor: 'A', Revenue: 150.5 },
    { Month: 'Oct-2026', Doctor: 'B', Revenue: 20 },
  ],
  sources: [],
};
const tile = (t: Partial<Tile> & Pick<Tile, 'type'>): Tile => ({ id: 't', title: 'T', y: { column: 'Revenue', agg: 'SUM' }, ...t });

describe('tile → Excel table', () => {
  it('a KPI with a comparison becomes one row with the change', () => {
    const t = tile({ type: 'kpi', title: 'Revenue', compare: { column: 'Month', mode: 'previous' } });
    const table = tileToTable(t, computeTile(t, data));
    expect(table?.columns.map((c) => c.header)).toEqual(['Measure', 'Oct-2026', 'Sep-2026', 'Change', 'Change %']);
    expect(table?.rows).toEqual([['Revenue', 170.5, 100, 70.5, 70.5]]);
  });

  it('a chart becomes one column per series, a table keeps its columns, a problem gives nothing', () => {
    const bar = tile({ type: 'bar', x: 'Doctor', sort: 'label' });
    expect(tileToTable(bar, computeTile(bar, data))).toEqual({
      title: 'T',
      columns: [{ header: 'Doctor', format: 'text' }, { header: 'Revenue', format: 'money' }],
      rows: [['A', 250.5], ['B', 20]],
    });
    const tbl = tile({ type: 'table', x: 'Doctor', compare: { column: 'Month', mode: 'previous' } });
    expect(tileToTable(tbl, computeTile(tbl, data))?.columns.map((c) => c.header)).toEqual(['Doctor', 'Oct-2026', 'Sep-2026', 'Change', 'Change %']);
    expect(tileToTable(tile({ type: 'bar', x: 'Nope' }), computeTile(tile({ type: 'bar', x: 'Nope' }), data))).toBeNull();
  });

  it('writes an Excel file with rupees as numbers and escaped text', async () => {
    const bytes = await exportTableTask({ title: '=Danger', columns: [{ header: 'Name', format: 'text' }, { header: 'Revenue', format: 'money' }], rows: [['+x', 12.5]] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Data')!;
    expect(ws.getCell('A1').value).toBe("'=Danger");
    expect(ws.getCell('A3').value).toBe("'+x");
    expect(ws.getCell('B3').value).toBe(12.5);
  });
});

describe('dashboard store', () => {
  it('collects the columns a template uses (tiles and filters)', () => {
    const [starter] = starterDashboards();
    expect(columnsUsed(starter!)).toEqual(expect.arrayContaining(['Month', 'Department', 'Total Revenue', 'Gross Profit', 'Doctor Name', 'IP Revenue', 'OP Revenue', 'OP Pharmacy']));
    expect(new Set(columnsUsed(starter!)).size).toBe(columnsUsed(starter!).length);
  });

  it('edits a draft, tracks unsaved changes, and adds tiles with new ids', () => {
    const s = useDash.getState();
    s.open(blankDashboard('Mine'));
    expect(useDash.getState().dirty).toBe(false);
    useDash.getState().addTile({ title: 'A', type: 'kpi', y: { column: 'Revenue', agg: 'SUM' } });
    useDash.getState().addTile({ title: 'B', type: 'kpi', y: { column: 'Revenue', agg: 'SUM' } });
    const { draft, dirty } = useDash.getState();
    expect(dirty).toBe(true);
    expect(draft?.tiles.map((t) => t.title)).toEqual(['A', 'B']);
    expect(new Set(draft?.tiles.map((t) => t.id)).size).toBe(2);
  });

  it('keeps the loaded data when another template is opened, and never stores it', () => {
    useSession.getState().setLastReport({ recipeId: 'r', recipeName: 'DRR', period: 'Oct-2026', columns: [{ name: 'Doctor', type: 'text', kind: 'group' }], rows: [{ Doctor: 'A' }] });
    useDash.getState().loadSession();
    expect(useDash.getState().data.rows).toHaveLength(1);
    useDash.getState().open(blankDashboard('Other'));
    expect(useDash.getState().data.rows).toHaveLength(1);
    useDash.getState().clearData();
    expect(useDash.getState().data.rows).toEqual([]);
  });

  it('says so when there is no report from this session', () => {
    useSession.getState().setLastReport(null);
    useDash.getState().loadSession();
    expect(useDash.getState().error).toMatch(/No report has been generated in this session yet/);
  });

  it('filters are per column and replace each other', () => {
    useDash.getState().setFilter('Month', ['Oct-2026']);
    useDash.getState().setFilter('Month', ['Sep-2026', 'Oct-2026']);
    expect(useDash.getState().filters).toEqual({ Month: ['Sep-2026', 'Oct-2026'] });
  });
});

describe('readOutputsTask', () => {
  it('reads several saved reports into one data set and names a file it cannot read', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('R');
    ws.addRow(['Doctor', 'Month', 'Revenue']);
    ws.addRow(['A', 'Sep-2026', 10]);
    ws.addRow(['Total', null, 10]);
    const good = new File([new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer)], 'sep.xlsx');
    const bad = new File([new TextEncoder().encode('not excel')], 'broken.xlsx');
    const r = await readOutputsTask({ files: [good, bad], recipe: null });
    expect(r.rows).toHaveLength(1);
    expect(r.sources.map((s) => [s.name, s.rows, s.skipped])).toEqual([['sep.xlsx', 1, 1], ['broken.xlsx', 0, 0]]);
    expect(r.sources[1]?.message).toBeTruthy();
  });
});
