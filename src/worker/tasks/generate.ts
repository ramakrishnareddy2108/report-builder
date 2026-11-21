// generate task: run the whole pipeline on the uploaded files.
// The full combined table stays in the worker (memory only, for the session) so "Download combined data" can use it
// without sending thousands of rows back and forth.

import type { CleanupReport } from '@/engine/cleanup';
import type { Check } from '@/engine/checks';
import { generate } from '@/engine/generate';
import type { LookupResult } from '@/engine/lookups';
import { combinedWorkbookBytes } from '@/engine/output';
import type { ReportResult } from '@/engine/report';
import type { CombinedTable, ParamValues, SourceSummary } from '@/engine/types';
import type { TemplateMappingEntry } from '@/excel/fillTemplate';
import { openWorkbook } from '@/excel/readWorkbook';
import type { Recipe } from '@/recipe/schema';
import type * as XLSX from 'xlsx';
import type { TaskProgress } from '../protocol';

export type GenerateRequest = {
  recipe: Recipe;
  params: ParamValues;
  assignments: { sourceId: string; file: File }[];
};

export type GenerateTaskResult = {
  canDownload: boolean;
  report: ReportResult | null;
  checks: Check[];
  sources: SourceSummary[];
  cleanup: CleanupReport[];
  lookups: LookupResult[];
  templateMapping: TemplateMappingEntry[] | null;
  /** The finished report workbook (null when an error stopped the run). */
  workbookBytes: Uint8Array | null;
  /** The first rows of the combined table, for a peek. */
  combinedPreview: CombinedTable;
  combinedRows: number;
};

const PREVIEW_ROWS = 200;

let lastCombined: CombinedTable | null = null;

export async function generateTask(req: GenerateRequest, onProgress: (p: TaskProgress) => void = () => {}): Promise<GenerateTaskResult> {
  const workbooks = new Map<File, XLSX.WorkBook>();
  const files: { sourceId: string; fileName: string; workbook: XLSX.WorkBook }[] = [];
  for (const [i, a] of req.assignments.entries()) {
    onProgress({ stage: `Opening ${a.file.name}`, fraction: (i / Math.max(req.assignments.length, 1)) * 0.1 });
    let workbook = workbooks.get(a.file);
    if (!workbook) {
      workbook = openWorkbook(new Uint8Array(await a.file.arrayBuffer()));
      workbooks.set(a.file, workbook);
    }
    files.push({ sourceId: a.sourceId, fileName: a.file.name, workbook });
  }

  const result = await generate({ recipe: req.recipe, params: req.params, files }, (p) => onProgress({ ...p, fraction: 0.1 + p.fraction * 0.9 }));
  lastCombined = result.combined;
  return {
    canDownload: result.canDownload,
    report: result.report,
    checks: result.checks,
    sources: result.sources,
    cleanup: result.cleanup,
    lookups: result.lookups,
    templateMapping: result.templateMapping,
    workbookBytes: result.workbookBytes,
    combinedPreview: { columns: result.combined.columns, rows: result.combined.rows.slice(0, PREVIEW_ROWS) },
    combinedRows: result.combined.rows.length,
  };
}

/** The combined table of the last generate, as an Excel file. */
export async function exportCombinedTask(): Promise<Uint8Array> {
  if (!lastCombined) throw new Error('There is no combined data yet. Click Generate first.');
  return combinedWorkbookBytes(lastCombined);
}
