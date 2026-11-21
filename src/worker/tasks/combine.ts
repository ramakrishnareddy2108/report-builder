// combine task: open the assigned files, read each source, stack them into the combined table.
// Runs in the worker (and in unit tests). Returns a limited number of rows for previews.

import { combine } from '@/engine/combine';
import { paramValues } from '@/engine/rowContext';
import { readSource } from '@/engine/readSource';
import type { CombinedTable, Issue, ParamValues, ReadSourceResult, SourceSummary } from '@/engine/types';
import type { Recipe } from '@/recipe/schema';
import type { TaskProgress } from '../protocol';
import { setLastCombined, workbookFor } from '../state';

export type CombineRequest = {
  recipe: Recipe;
  params: ParamValues;
  /** Which uploaded file feeds which source. */
  assignments: { sourceId: string; file: File }[];
  /** Return at most this many combined rows (the total is always reported). Default: all. */
  maxRows?: number;
};

export type CombineTaskResult = {
  table: CombinedTable;
  /** Rows in the whole combined table, even when `table.rows` was cut to `maxRows`. */
  totalRows: number;
  sources: SourceSummary[];
  issues: Issue[];
};

type Progress = (p: TaskProgress) => void;

export async function combineTask(req: CombineRequest, onProgress: Progress = () => {}): Promise<CombineTaskResult> {
  const { recipe } = req;
  const issues: Issue[] = [];
  const readings: Parameters<typeof combine>[0][number][] = [];
  const params = paramValues(recipe.parameters, req.params);

  const total = recipe.sources.length;
  for (const [i, source] of recipe.sources.entries()) {
    const assigned = req.assignments.find((a) => a.sourceId === source.id);
    onProgress({ stage: `Reading ${source.label}`, fraction: i / Math.max(total, 1) });
    if (!assigned) {
      issues.push(
        source.required
          ? { level: 'error', sourceId: source.id, message: `${source.label}: no file was added for this source. Add the file, or mark the source as optional in the recipe.` }
          : { level: 'info', sourceId: source.id, message: `${source.label}: optional source, no file added. It is left out.` },
      );
      continue;
    }
    const workbook = await workbookFor(assigned.file);
    const result = readSource({ name: assigned.file.name, workbook }, source, params);
    readings.push({ source, fileName: assigned.file.name, result });
  }

  onProgress({ stage: 'Combining', fraction: 0.95 });
  const combined = combine(readings, recipe, req.params);
  issues.push(...readings.flatMap((r) => r.result.errors), ...combined.issues);

  setLastCombined(combined.table);
  const rows = req.maxRows === undefined ? combined.table.rows : combined.table.rows.slice(0, req.maxRows);
  onProgress({ stage: 'Done', fraction: 1 });
  return {
    table: { columns: combined.table.columns, rows },
    totalRows: combined.table.rows.length,
    sources: readings.map(({ fileName, result }) => ({ ...withoutRows(result), fileName })),
    issues,
  };
}

function withoutRows(result: ReadSourceResult): Omit<ReadSourceResult, 'rows'> {
  const { rows: _rows, ...rest } = result;
  void _rows;
  return rest;
}
