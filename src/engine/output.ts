// Pipeline step 10: the output workbook.
//
// Two stages, because the Checks sheet must include the notes from filling the template:
//   startOutput   → the report sheet (plain) or the filled template (template mode), and any template notes
//   finishOutput  → adds the Checks and Combined sheets when the recipe asks for them, and returns the file bytes

import ExcelJS from 'exceljs';
import { addChecksSheet, addCombinedSheet, addIntermediateSummarySheet, addReportSheet, addSourceSheet, workbookBytes } from '@/excel/writePlain';
import { fillTemplate, makeExcelSafe, openTemplateWorkbook, TemplateError, type TemplateMappingEntry, type TemplateNote } from '@/excel/fillTemplate';
import type { OutputDef } from '@/recipe/schema';
import type { Recipe } from '@/recipe/schema';
import type { Check } from './checks';
import { intermediateSheets } from './intermediate';
import type { ReportResult } from './report';
import type { CombinedTable, SourceSummary } from './types';

export type StartedOutput = {
  workbook: ExcelJS.Workbook;
  notes: TemplateNote[];
  /** Template mode: how each report column maps to the template. */
  mapping: TemplateMappingEntry[] | null;
};

export async function startOutput(output: OutputDef, report: ReportResult, templateBytes: Uint8Array | null): Promise<StartedOutput> {
  if (output.mode === 'plain') {
    const workbook = new ExcelJS.Workbook();
    addReportSheet(workbook, output.sheetName, report);
    return { workbook, notes: [], mapping: null };
  }
  if (!templateBytes || templateBytes.length === 0) {
    throw new TemplateError(`No template has been added to this recipe${output.templateName ? ` (“${output.templateName}”)` : ''}. Open the recipe, go to Output and upload the template.`);
  }
  const workbook = await openTemplateWorkbook(templateBytes);
  const safetyNotes = makeExcelSafe(workbook);
  const filled = fillTemplate(workbook, output, report);
  return { workbook, notes: [...safetyNotes, ...filled.notes], mapping: filled.mapping };
}

export async function finishOutput(started: StartedOutput, output: OutputDef, checks: readonly Check[], combined: CombinedTable): Promise<Uint8Array> {
  if (output.includeChecksSheet) addChecksSheet(started.workbook, checks);
  if (output.includeCombinedSheet) addCombinedSheet(started.workbook, combined);
  return workbookBytes(started.workbook);
}

/** A workbook with only the combined table (the optional "Download combined data"). */
export async function combinedWorkbookBytes(combined: CombinedTable): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  addCombinedSheet(workbook, combined);
  return workbookBytes(workbook);
}

/**
 * The intermediate workbook: a Summary sheet, then one sheet per source file with only the selected columns.
 * It is made from the same combined table the report is built from, so it can be made even when the report is blocked.
 */
export async function intermediateWorkbookBytes(combined: CombinedTable, recipe: Pick<Recipe, 'sources' | 'lookups'>, sources: readonly SourceSummary[]): Promise<Uint8Array> {
  const sheets = intermediateSheets(combined, recipe, sources);
  const workbook = new ExcelJS.Workbook();
  addIntermediateSummarySheet(workbook, sheets, sources);
  for (const s of sheets) addSourceSheet(workbook, s);
  return workbookBytes(workbook);
}
