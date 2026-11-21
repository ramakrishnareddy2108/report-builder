import { describe, expect, it } from 'vitest';
import {
  addDashboard,
  addTile,
  deleteDashboard,
  deleteTile,
  duplicateDashboard,
  emptyDashboard,
  moveTile,
  newTile,
  uniqueId,
  updateDashboard,
  updateTile,
} from '@/core/dashboardEdit';
import { starterDashboardsFile } from '@/core/dashboardStarters';
import { DashboardsFileSchema } from '@/core/schemas';

const file = () => starterDashboardsFile();

describe('ids', () => {
  it('are made from the name and never repeat', () => {
    expect(uniqueId('Top 15 doctors!', [])).toBe('top-15-doctors');
    expect(uniqueId('Review', ['review', 'review-2'])).toBe('review-3');
    expect(uniqueId('???', [])).toBe('item');
  });
});

describe('editing dashboards', () => {
  it('adds an empty dashboard that shows the newest Final month, and deletes one', () => {
    const f = file();
    const added = addDashboard(f, emptyDashboard('  My view ', f.dashboards.map((d) => d.id)));
    expect(added.dashboards.at(-1)).toMatchObject({ id: 'my-view', name: 'My view', months: { mode: 'latest' }, tiles: [] });
    expect(deleteDashboard(added, 'my-view').dashboards).toHaveLength(6);
    expect(f.dashboards).toHaveLength(6); // the original is not changed
  });

  it('renames and changes the filters of a dashboard, leaving the others alone', () => {
    const f = file();
    const r = updateDashboard(f, 'sponsor-mix', { name: 'Payers', departments: ['Urology'], months: { mode: 'last', count: 6 } });
    expect(r.dashboards.find((d) => d.id === 'sponsor-mix')).toMatchObject({ name: 'Payers', departments: ['Urology'], months: { mode: 'last', count: 6 } });
    expect(r.dashboards.find((d) => d.id === 'variance')).toBe(f.dashboards.find((d) => d.id === 'variance'));
  });

  it('duplicates with its own id and its own tiles', () => {
    const f = duplicateDashboard(file(), 'variance', 'Variance copy');
    const copy = f.dashboards.at(-1)!;
    expect(copy.id).toBe('variance-copy');
    expect(copy.tiles).toEqual(f.dashboards.find((d) => d.id === 'variance')!.tiles);
    expect(copy.tiles[0]).not.toBe(f.dashboards.find((d) => d.id === 'variance')!.tiles[0]);
    expect(duplicateDashboard(file(), 'nope', 'x')).toEqual(file());
  });

  it('stays valid against the schema after every edit', () => {
    let f = file();
    f = addDashboard(f, emptyDashboard('A', f.dashboards.map((d) => d.id)));
    f = addTile(f, 'a', newTile('Revenue', []));
    f = updateTile(f, 'a', { ...newTile('Revenue', []), x: 'doctor', topN: 5 });
    f = moveTile(f, 'variance', 'var-profit', 'up');
    f = duplicateDashboard(f, 'a', 'A2');
    expect(DashboardsFileSchema.safeParse(f).success).toBe(true);
  });
});

describe('editing tiles', () => {
  it('adds a tile with defaults, updates it, and deletes it', () => {
    let f = addDashboard(file(), emptyDashboard('A', []));
    f = addTile(f, 'a', newTile('Total Revenue', []));
    expect(f.dashboards.at(-1)?.tiles[0]).toMatchObject({ id: 'total-revenue', type: 'bar', x: 'month', measures: ['TOTAL_REVENUE'], agg: 'sum', compare: 'none' });
    f = updateTile(f, 'a', { ...f.dashboards.at(-1)!.tiles[0]!, title: 'Renamed', type: 'line' });
    expect(f.dashboards.at(-1)?.tiles[0]).toMatchObject({ title: 'Renamed', type: 'line' });
    f = deleteTile(f, 'a', 'total-revenue');
    expect(f.dashboards.at(-1)?.tiles).toEqual([]);
  });

  it('moves a tile up or down one place; the ends stay put', () => {
    const ids = (f: ReturnType<typeof file>) => f.dashboards.find((d) => d.id === 'variance')!.tiles.map((t) => t.id);
    const base = ids(file());
    expect(ids(moveTile(file(), 'variance', base[1] as string, 'up'))).toEqual([base[1], base[0], ...base.slice(2)]);
    expect(ids(moveTile(file(), 'variance', base[0] as string, 'down'))).toEqual([base[1], base[0], ...base.slice(2)]);
    expect(ids(moveTile(file(), 'variance', base[0] as string, 'up'))).toEqual(base);
    expect(ids(moveTile(file(), 'variance', base.at(-1) as string, 'down'))).toEqual(base);
    expect(ids(moveTile(file(), 'variance', 'nope', 'down'))).toEqual(base);
  });
});
