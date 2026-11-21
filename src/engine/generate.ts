// The whole pipeline: read sources → combine → cleanup → lookups → report → checks → output.
// Pure apart from Excel parsing and writing, so it runs in the worker and in unit tests alike.

import type * as XLSX from 'xlsx';
import { base64ToBytes } from '@/lib/base64';
import type { Recipe } from '@/recipe/schema';
import { TemplateError } from '@/excel/fillTemplate';
import { buildChecks, hasErrors, type Check } from './checks';
import { cleanup, type CleanupReport } from './cleanup';
import { combine, type SourceReading } from './combine';
import { runLookups, type LookupResult } from './lookups';
import { finishOutput, startOutput, type StartedOutput } from './output';
import { readSource } from './readSource';
import { buildReport, type ReportResult } from './report';
import { paramValues } from './rowContext';
import type { CombinedTable, Issue, ParamValues, SourceSummary } from './types';

export type GenerateInput = {
  recipe: Recipe;
  params: ParamValues;
  /** The uploaded files, already opened: which file feeds which source. */
  files: { sourceId: string; fileName: string; workbook: XLSX.WorkBook }[];
};

export type GenerateResult = {
  /** True when the report can be downloaded: it was built and no check is an error. */
  canDownload: boolean;
  report: ReportResult | null;
  combined: CombinedTable;
  checks: Check[];
  sources: SourceSummary[];
  cleanup: CleanupReport[];
  lookups: LookupResult[];
  /** The finished .xlsx (null when an error stopped the run before the report). */
  workbookBytes: Uint8Array | null;
  /** Template mode: how the report columns map to the template. */
  templateMapping: StartedOutput['mapping'];
};

export type GenerateProgress = (p: { stage: string; fraction: number; detail?: string }) => void;

export async function generate(input: GenerateInput, onProgress: GenerateProgress = () => {}): Promise<GenerateResult> {
  const { recipe } = input;
  const issues: Issue[] = [];
  const readings: SourceReading[] = [];
  const params = paramValues(recipe.parameters, input.params);

  for (const p of recipe.parameters) {
    if ((input.params[p.name] ?? '').trim() === '') issues.push({ level: 'error', message: `Enter a value for “${p.label || p.name}”.`, column: p.name });
  }

  // 1–4: read every source
  const total = Math.max(recipe.sources.length, 1);
  for (const [i, source] of recipe.sources.entries()) {
    onProgress({ stage: `Reading ${source.label}`, fraction: (i / total) * 0.5 });
    const file = input.files.find((f) => f.sourceId === source.id);
    if (!file) {
      issues.push(
        source.required
          ? { level: 'error', sourceId: source.id, message: `${source.label}: no file was added for this source. Add the file, or mark the source as optional in the recipe.` }
          : { level: 'info', sourceId: source.id, message: `${source.label}: optional source, no file added. It is left out.` },
      );
      continue;
    }
    const result = readSource({ name: file.fileName, workbook: file.workbook }, source, params);
    readings.push({ source, fileName: file.fileName, result });
    issues.push(...result.errors);
  }

  // 5: combine
  onProgress({ stage: 'Combining the files', fraction: 0.55 });
  const combined = combine(readings, recipe, input.params);
  issues.push(...combined.issues);
  const table = combined.table;
  const sources: SourceSummary[] = readings.map(({ fileName, result }) => {
    const { rows: _rows, ...rest } = result;
    void _rows;
    return { ...rest, fileName };
  });

  const finishEarly = (cleanupReports: CleanupReport[] = [], lookups: LookupResult[] = []): GenerateResult => {
    const checks = buildChecks({ recipe, issues, sources, combinedRows: table.rows.length, cleanup: cleanupReports, lookups, report: null });
    return { canDownload: false, report: null, combined: table, checks, sources, cleanup: cleanupReports, lookups, workbookBytes: null, templateMapping: null };
  };
  if (issues.some((i) => i.level === 'error')) return finishEarly();

  // 6: names
  onProgress({ stage: 'Cleaning names', fraction: 0.65 });
  const cleaned = cleanup(table, recipe.cleanup);
  issues.push(...cleaned.issues);
  if (cleaned.issues.some((i) => i.level === 'error')) return finishEarly(cleaned.reports);

  // 7: lookups
  onProgress({ stage: 'Matching lookups', fraction: 0.72 });
  const looked = runLookups(table, recipe.lookups, recipe, params);
  issues.push(...looked.issues);
  if (looked.issues.some((i) => i.level === 'error')) return finishEarly(cleaned.reports, looked.results);

  // 8: report
  onProgress({ stage: 'Building the report', fraction: 0.8 });
  const report = buildReport(table, recipe.report, params);
  issues.push(...report.issues);
  if (report.issues.some((i) => i.level === 'error')) return finishEarly(cleaned.reports, looked.results);

  // 10 (first half): the template fill adds notes that the Checks sheet must show
  onProgress({ stage: 'Filling the output', fraction: 0.88 });
  let started: StartedOutput;
  try {
    const bytes = recipe.output.mode === 'template' && recipe.output.templateBase64 ? base64ToBytes(recipe.output.templateBase64) : null;
    started = await startOutput(recipe.output, report, bytes);
  } catch (err) {
    if (!(err instanceof TemplateError)) throw err;
    issues.push({ level: 'error', message: err.message });
    const checks = buildChecks({ recipe, issues, sources, combinedRows: table.rows.length, cleanup: cleaned.reports, lookups: looked.results, report });
    return { canDownload: false, report, combined: table, checks, sources, cleanup: cleaned.reports, lookups: looked.results, workbookBytes: null, templateMapping: null };
  }

  // 9: checks
  onProgress({ stage: 'Running checks', fraction: 0.93 });
  const checks = buildChecks({
    recipe,
    issues,
    sources,
    combinedRows: table.rows.length,
    cleanup: cleaned.reports,
    lookups: looked.results,
    report,
    templateNotes: started.notes,
  });

  // 10 (second half): checks and combined sheets, then the bytes
  onProgress({ stage: 'Saving the workbook', fraction: 0.97 });
  const workbookBytes = await finishOutput(started, recipe.output, checks, table);
  onProgress({ stage: 'Done', fraction: 1 });
  return {
    canDownload: !hasErrors(checks),
    report,
    combined: table,
    checks,
    sources,
    cleanup: cleaned.reports,
    lookups: looked.results,
    workbookBytes,
    templateMapping: started.mapping,
  };
}
