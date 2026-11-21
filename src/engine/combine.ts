// Pipeline step 5: stack every source into the combined table.
//
// The combined table is the union of all sources' renamed + calculated columns, plus
//   Source  (the source's label) · _file · _row (Excel row number) · every recipe parameter as a constant column.
// A source that lacks a column gets blank in it. The same column name must have the same type in every source
// (an amount that is money in one file and text in another would silently break the sums).

import type { ColumnType, Recipe, SourceDef } from '@/recipe/schema';
import { FILE_COLUMN, ROW_COLUMN, SOURCE_COLUMN, type ColumnDef, type CombinedRow, type CombinedTable, type Issue, type ParamValues, type ReadSourceResult } from './types';

export type SourceReading = {
  source: Pick<SourceDef, 'id' | 'label'>;
  fileName: string;
  result: ReadSourceResult;
};

export type CombineResult = {
  table: CombinedTable;
  issues: Issue[];
};

/** A parameter's value as stored in the combined table: numbers as numbers, everything else as text. */
function paramCell(type: 'text' | 'number' | 'date', raw: string): string | number | null {
  const text = raw.trim();
  if (text === '') return null;
  if (type === 'number') {
    const n = Number(text.replace(/,/g, ''));
    return Number.isFinite(n) ? n : text;
  }
  return text;
}

export function combine(readings: readonly SourceReading[], recipe: Pick<Recipe, 'parameters'> & { sources?: readonly SourceDef[] }, params: ParamValues): CombineResult {
  const issues: Issue[] = [];
  const columns: ColumnDef[] = [];
  const typeOf = new Map<string, { type: ColumnType; sourceLabel: string }>(); // upper-case name → first definition

  const add = (name: string, type: ColumnType, sourceLabel: string, sourceId?: string) => {
    const key = name.toUpperCase();
    const seen = typeOf.get(key);
    if (!seen) {
      typeOf.set(key, { type, sourceLabel });
      columns.push({ name, type });
    } else if (seen.type !== type) {
      issues.push({
        level: 'error',
        sourceId,
        column: name,
        message: `Column “${name}” is ${seen.type} in ${seen.sourceLabel} but ${type} in ${sourceLabel}. Give it the same type in both sources, or use a different name.`,
      });
    }
  };

  // Columns the recipe declares, even for a source that has no file this time (an optional source), so that
  // report columns built on them simply come out as zero instead of failing.
  for (const def of recipe.sources ?? []) {
    for (const c of def.columns) add(c.as, c.type, def.label, def.id);
    for (const c of def.calculated) add(c.as, c.type, def.label, def.id);
  }
  for (const reading of readings) {
    for (const c of reading.result.columns) add(c.name, c.type, reading.source.label, reading.source.id);
  }

  // The app's own columns come last; a source column with the same name was already rejected by readSource.
  const paramDefs = recipe.parameters;
  for (const p of paramDefs) {
    const clash = typeOf.get(p.name.toUpperCase());
    if (clash) {
      issues.push({
        level: 'error',
        column: p.name,
        message: `The parameter “${p.name}” has the same name as a column in ${clash.sourceLabel}. Rename one of them.`,
      });
    }
  }
  const appColumns: ColumnDef[] = [
    { name: SOURCE_COLUMN, type: 'text' },
    { name: FILE_COLUMN, type: 'text' },
    { name: ROW_COLUMN, type: 'number' },
    ...paramDefs.map((p): ColumnDef => ({ name: p.name, type: p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : 'text' })),
  ];
  for (const c of appColumns) {
    if (!typeOf.has(c.name.toUpperCase())) {
      typeOf.set(c.name.toUpperCase(), { type: c.type, sourceLabel: 'the app' });
      columns.push(c);
    }
  }

  const paramCells = paramDefs.map((p) => [p.name, paramCell(p.type, params[p.name] ?? '')] as const);
  const rows: CombinedRow[] = [];
  for (const reading of readings) {
    if (reading.result.errors.length > 0) continue; // nothing was read from this source
    for (const src of reading.result.rows) {
      const row: CombinedRow = {};
      for (const c of columns) row[c.name] = null;
      for (const [name, value] of Object.entries(src.values)) row[name] = value;
      row[SOURCE_COLUMN] = reading.source.label;
      row[FILE_COLUMN] = reading.fileName;
      row[ROW_COLUMN] = src.row;
      for (const [name, value] of paramCells) row[name] = value;
      rows.push(row);
    }
  }

  return { table: { columns, rows }, issues };
}
