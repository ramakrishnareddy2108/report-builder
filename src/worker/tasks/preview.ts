// preview task: what the Prepare and Report tabs show while the user edits the recipe.
// It runs the same steps as Generate (read, combine, clean names, lookups, report), without the output file.

import type { CleanupReport } from '@/engine/cleanup';
import { prepareData } from '@/engine/generate';
import type { LookupResult } from '@/engine/lookups';
import { buildReport, type ReportResult } from '@/engine/report';
import { paramValues } from '@/engine/rowContext';
import type { ColumnDef, Issue, ParamValues, SourceSummary } from '@/engine/types';
import type { Recipe } from '@/recipe/schema';
import type { TaskProgress } from '../protocol';
import { workbookFor } from '../state';

export type PreviewRequest = {
  recipe: Recipe;
  params: ParamValues;
  assignments: { sourceId: string; file: File }[];
  /** 'prepare' stops after the lookups; 'report' also builds the report. */
  stage: 'prepare' | 'report';
};

export type PreviewResult = {
  issues: Issue[];
  sources: SourceSummary[];
  cleanup: CleanupReport[];
  lookups: LookupResult[];
  /** The combined columns after lookups (including the ones lookups write). */
  columns: ColumnDef[];
  combinedRows: number;
  report: ReportResult | null;
};

export async function previewTask(req: PreviewRequest, onProgress: (p: TaskProgress) => void = () => {}): Promise<PreviewResult> {
  const files = [];
  for (const a of req.assignments) files.push({ sourceId: a.sourceId, fileName: a.file.name, workbook: await workbookFor(a.file) });

  // A preview is useful before the month is typed in, so empty parameters are not an error here.
  const prepared = prepareData({ recipe: req.recipe, params: req.params, files }, onProgress, false);
  let report: ReportResult | null = null;
  const issues = [...prepared.issues];
  if (req.stage === 'report' && !prepared.stopped) {
    report = buildReport(prepared.table, req.recipe.report, paramValues(req.recipe.parameters, req.params));
    issues.push(...report.issues);
  }
  return {
    issues,
    sources: prepared.sources,
    cleanup: prepared.cleanup,
    lookups: prepared.lookups,
    columns: prepared.table.columns,
    combinedRows: prepared.table.rows.length,
    report,
  };
}
