// Editing dashboards.json in memory: add, rename, delete and reorder dashboards and tiles.
// Every function returns a new file; nothing is changed in place.

import type { Dashboard, DashboardsFile, Tile } from './schemas';

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';

/** An id based on `text`, unique among `taken`. */
export function uniqueId(text: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slug(text);
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** A new, empty dashboard that shows the newest Final month. */
export function emptyDashboard(name: string, taken: Iterable<string>): Dashboard {
  return { id: uniqueId(name, taken), name: name.trim(), months: { mode: 'latest' }, departments: [], sponsors: [], tiles: [] };
}

/** A new tile with sensible settings: Total Revenue by month as a bar chart. */
export function newTile(title: string, taken: Iterable<string>): Tile {
  return {
    id: uniqueId(title, taken),
    title: title.trim() || 'New tile',
    type: 'bar',
    x: 'month',
    measures: ['TOTAL_REVENUE'],
    agg: 'sum',
    split: null,
    filters: { doctors: [], departments: [], sponsors: [] },
    topN: null,
    sort: 'desc',
    compare: 'none',
  };
}

const withDashboards = (file: DashboardsFile, dashboards: Dashboard[]): DashboardsFile => ({ ...file, dashboards });
const mapDashboard = (file: DashboardsFile, id: string, f: (d: Dashboard) => Dashboard): DashboardsFile =>
  withDashboards(file, file.dashboards.map((d) => (d.id === id ? f(d) : d)));

export function addDashboard(file: DashboardsFile, dashboard: Dashboard): DashboardsFile {
  return withDashboards(file, [...file.dashboards, dashboard]);
}

export function deleteDashboard(file: DashboardsFile, id: string): DashboardsFile {
  return withDashboards(file, file.dashboards.filter((d) => d.id !== id));
}

export function updateDashboard(file: DashboardsFile, id: string, patch: Partial<Omit<Dashboard, 'id' | 'tiles'>>): DashboardsFile {
  return mapDashboard(file, id, (d) => ({ ...d, ...patch }));
}

/** A copy of a dashboard under a new name, with its own id. */
export function duplicateDashboard(file: DashboardsFile, id: string, name: string): DashboardsFile {
  const source = file.dashboards.find((d) => d.id === id);
  if (!source) return file;
  return addDashboard(file, { ...structuredClone(source), id: uniqueId(name, file.dashboards.map((d) => d.id)), name: name.trim() });
}

export function addTile(file: DashboardsFile, dashboardId: string, tile: Tile): DashboardsFile {
  return mapDashboard(file, dashboardId, (d) => ({ ...d, tiles: [...d.tiles, tile] }));
}

export function updateTile(file: DashboardsFile, dashboardId: string, tile: Tile): DashboardsFile {
  return mapDashboard(file, dashboardId, (d) => ({ ...d, tiles: d.tiles.map((t) => (t.id === tile.id ? tile : t)) }));
}

export function deleteTile(file: DashboardsFile, dashboardId: string, tileId: string): DashboardsFile {
  return mapDashboard(file, dashboardId, (d) => ({ ...d, tiles: d.tiles.filter((t) => t.id !== tileId) }));
}

/** Move a tile one place up or down (the grid has no free drag). A tile at the end stays. */
export function moveTile(file: DashboardsFile, dashboardId: string, tileId: string, direction: 'up' | 'down'): DashboardsFile {
  return mapDashboard(file, dashboardId, (d) => {
    const from = d.tiles.findIndex((t) => t.id === tileId);
    const to = direction === 'up' ? from - 1 : from + 1;
    if (from === -1 || to < 0 || to >= d.tiles.length) return d;
    const tiles = [...d.tiles];
    const [moved] = tiles.splice(from, 1);
    tiles.splice(to, 0, moved as Tile);
    return { ...d, tiles };
  });
}
