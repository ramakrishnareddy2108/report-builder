import { describe, expect, it } from 'vitest';
import { NAV_PAGES, parseHash, routeToHash } from '@/app/nav';
import { inspectFileTask } from '@/worker/tasks/inspectFile';
import { consultationsWorkbook } from '../helpers/syntheticWorkbook';

describe('navigation', () => {
  it('lists the menu pages in order with unique ids', () => {
    expect(NAV_PAGES.map((p) => p.label)).toEqual(['Home', 'Generate', 'Dashboards', 'Help']);
    expect(new Set(NAV_PAGES.map((p) => p.id)).size).toBe(NAV_PAGES.length);
  });

  it('turns an address into a route and back', () => {
    expect(parseHash('')).toEqual({ page: 'home' });
    expect(parseHash('#/nonsense')).toEqual({ page: 'home' });
    expect(parseHash('#/generate/abc%20d')).toEqual({ page: 'generate', recipeId: 'abc d' });
    expect(parseHash('#/dashboards/x1')).toEqual({ page: 'dashboards', dashboardId: 'x1' });
    expect(routeToHash({ page: 'recipe', recipeId: 'a b' })).toBe('#/recipe/a%20b');
    expect(routeToHash({ page: 'help' })).toBe('#/help');
  });
});

describe('inspectFileTask', () => {
  const file = new File([consultationsWorkbook() as Uint8Array<ArrayBuffer>], 'x.xlsx');

  it('lists sheets and detects the header on row 3', async () => {
    const r = await inspectFileTask({ file });
    expect(r.sheets.map((s) => s.name)).toEqual(['Sheet1', 'Sheet2', 'Offset']);
    expect(r.sheet).toBe('Sheet1');
    expect(r.header?.headerRow).toBe(3);
    expect(r.data?.rows.length).toBe(6);
  });

  it('honours a chosen sheet, header row and row limit', async () => {
    const r = await inspectFileTask({ file, sheet: 'Offset', headerRow: 5, maxRows: 5 });
    expect(r.header?.rawHeaders.slice(2)).toEqual(['BILLNO', 'AMOUNT']);
    expect(r.data?.rowCount).toBe(5);
  });
});
