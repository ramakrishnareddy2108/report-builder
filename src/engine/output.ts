// Pipeline step 10: the output workbook.
//
// Two stages, because the Checks sheet must include the notes from filling the template:
//   startOutput   → the report sheet (plain) or the filled template (template mode), and any template notes
//   finishOutput  → adds the Checks and Combined sheets when the recipe asks for them, and returns the file bytes

import ExcelJS from 'exceljs';
import { addChecksSheet, addCombinedSheet, addReportSheet, workbookBytes } from '@/excel/writePlain';
import { fillTemplate, openTemplateWorkbook, TemplateError, type TemplateMappingEntry, type TemplateNote } from '@/excel/fillTemplate';
import type { OutputDef } from '@/recipe/schema';
import type { Check } from './checks';
import type { ReportResult } from './report';
import type { CombinedTable } from './types';

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
  const filled = fillTemplate(workbook, output, report);
  return { workbook, notes: filled.notes, mapping: filled.mapping };
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
