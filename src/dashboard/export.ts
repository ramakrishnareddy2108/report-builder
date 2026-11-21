// A tile's numbers as a plain table, for "data to Excel".

import type { TableExportInput } from '@/excel/tableSheet';
import type { Tile } from './schema';
import type { TileResult } from './tiles';

export function tileToTable(tile: Tile, result: TileResult): TableExportInput | null {
  if (result.status !== 'ok') return null;
  if (result.kind === 'kpi') {
    const fmt = result.format;
    const columns: TableExportInput['columns'] = [{ header: 'Measure', format: 'text' }, { header: result.period?.latest ?? 'Value', format: fmt }];
    const row: (string | number | null)[] = [tile.title, result.value];
    if (result.period) {
      columns.push({ header: result.period.previous, format: fmt }, { header: 'Change', format: fmt }, { header: 'Change %', format: 'percent' });
      row.push(result.previous, result.change, result.changePct === null ? null : Number(result.changePct.toFixed(2)));
    }
    return { title: tile.title, columns, rows: [row] };
  }
  if (result.kind === 'chart') {
    return {
      title: tile.title,
      columns: [{ header: tile.x ?? 'Category', format: 'text' }, ...result.series.map((s) => ({ header: s.name, format: result.format }))],
      rows: result.categories.map((c, i) => [c, ...result.series.map((s) => s.values[i] ?? null)]),
    };
  }
  return {
    title: tile.title,
    columns: result.columns.map((c) => ({ header: c.label, format: c.format })),
    rows: result.rows.map((r) => result.columns.map((c) => (r[c.key] ?? null) as string | number | null)),
  };
}
