// A tile's numbers as a plain table: what the Table tile shows and what "export to Excel" writes.

import type { TileData } from './dashboard';
import { DIMENSION_LABELS, type Tile } from './schemas';

export type TileColumn = { header: string; kind: 'text' | 'money' | 'count' | 'percent' };

export type TileTable = {
  columns: TileColumn[];
  /** Money cells are integer paise, counts are plain numbers, percents are a number (1 decimal). */
  rows: (string | number | null)[][];
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Rows are the categories (months, doctors, ...); columns are the series, with the comparison month beside each. */
export function tileTable(tile: Tile, data: TileData): TileTable {
  const kind: TileColumn['kind'] = data.unit === 'count' ? 'count' : 'money';
  const first = tile.type === 'kpi' ? 'Measure' : DIMENSION_LABELS[tile.x];
  const columns: TileColumn[] = [{ header: first, kind: 'text' }];
  data.series.forEach((s) => {
    columns.push({ header: data.compare ? `${s.name} (${data.monthsUsed.at(-1) ?? 'now'})` : s.name, kind });
    if (data.compare) columns.push({ header: `${s.name} (${data.compare.month})`, kind }, { header: `${s.name} change`, kind }, { header: `${s.name} change %`, kind: 'percent' });
  });

  const rows = data.categories.map((cat, i) => {
    const row: (string | number | null)[] = [cat.label];
    data.series.forEach((s, si) => {
      const now = s.values[i] ?? null;
      row.push(now);
      if (data.compare) {
        const before = data.compare.series[si]?.values[i] ?? null;
        const change = now === null && before === null ? null : (now ?? 0) - (before ?? 0);
        row.push(before, change, before === null || before === 0 || change === null ? null : round1((change / Math.abs(before)) * 100));
      }
    });
    return row;
  });
  return { columns, rows };
}
