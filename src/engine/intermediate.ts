// The intermediate workbook: what the app has read from each file, before the report is built.
//
// One sheet per source file, holding only the columns the recipe selected (renamed + calculated columns, and the
// columns that lookups fill for that source), after the row filter, name cleanup and lookups. Plus a Summary sheet
// that says which file fed each sheet and how many rows were read, left out and used.
//
// Pure: it takes the combined table the pipeline already built, so it shows exactly what the report is made from.

import type { Recipe } from '@/recipe/schema';
import { FILE_COLUMN, ROW_COLUMN, SOURCE_COLUMN, type ColumnDef, type CombinedRow, type CombinedTable, type SourceSummary } from './types';

export type IntermediateSheet = {
  sourceId: string;
  label: string;
  fileName: string | null;
  columns: ColumnDef[];
  rows: CombinedRow[];
};

/** Excel row number in the original file: kept on every sheet so a value can be traced back. */
export const EXCEL_ROW_HEADING = ROW_COLUMN;

/**
 * Splits the combined table back into one table per source.
 * A source with no file this month (an optional source) is listed with no rows, so the gap is visible.
 */
export function intermediateSheets(table: CombinedTable, recipe: Pick<Recipe, 'sources' | 'lookups'>, sources: readonly Pick<SourceSummary, 'sourceId' | 'fileName'>[]): IntermediateSheet[] {
  const tableColumn = (name: string): ColumnDef | undefined => table.columns.find((c) => c.name.toUpperCase() === name.toUpperCase());

  return recipe.sources.map((def) => {
    // Selected columns first (in the order of the recipe), then what lookups wrote on this source's rows.
    const wanted = [
      ...def.columns.map((c) => c.as),
      ...def.calculated.map((c) => c.as),
      ...recipe.lookups
        .filter((l) => l.target.source === def.id)
        .flatMap((l) => [l.target.column, ...(l.from.extraValues ?? []).map((e) => e.as), ...(l.writeStatusColumn ? [l.writeStatusColumn] : [])]),
    ];
    const columns: ColumnDef[] = [];
    for (const name of wanted) {
      const found = tableColumn(name);
      if (found && !columns.some((c) => c.name === found.name)) columns.push(found);
    }
    const rowColumn = tableColumn(ROW_COLUMN);
    if (rowColumn) columns.push(rowColumn);

    const rows = table.rows.filter((r) => r[SOURCE_COLUMN] === def.label);
    return {
      sourceId: def.id,
      label: def.label,
      fileName: sources.find((s) => s.sourceId === def.id)?.fileName ?? (rows[0]?.[FILE_COLUMN] as string | undefined) ?? null,
      columns,
      rows,
    };
  });
}
