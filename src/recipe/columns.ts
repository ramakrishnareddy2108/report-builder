// The columns the combined data will have, worked out from the recipe alone (no files needed),
// so the builder can offer them in pick lists before anything has been read.

import { FILE_COLUMN, ROW_COLUMN, SOURCE_COLUMN } from '@/engine/types';
import type { ColumnType, Recipe } from './schema';

export type NamedColumn = { name: string; type: ColumnType };

export function combinedColumns(recipe: Pick<Recipe, 'sources' | 'parameters' | 'lookups'>): NamedColumn[] {
  const out: NamedColumn[] = [];
  const add = (name: string, type: ColumnType) => {
    if (name.trim() === '' || out.some((c) => c.name.toUpperCase() === name.toUpperCase())) return;
    out.push({ name, type });
  };
  for (const s of recipe.sources) {
    for (const c of s.columns) add(c.as, c.type);
    for (const c of s.calculated) add(c.as, c.type);
  }
  for (const l of recipe.lookups) {
    add(l.target.column, 'text');
    for (const e of l.from.extraValues ?? []) add(e.as, 'text');
    if (l.writeStatusColumn) add(l.writeStatusColumn, 'text');
  }
  add(SOURCE_COLUMN, 'text');
  add(FILE_COLUMN, 'text');
  add(ROW_COLUMN, 'number');
  for (const p of recipe.parameters) add(p.name, p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : 'text');
  return out;
}
