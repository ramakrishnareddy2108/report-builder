// Build one report workbook: the filled template plus the Checks and Data sheets.

import type { ReportKind } from '@/core/measures';
import type { ReportRow } from '@/core/report';
import type { CheckResult, FactRow } from '@/core/types';
import { fillTable, type FillResult } from './fillTemplate';
import { addChecksSheet, addDataSheet } from './reportSheets';
import { verifyCalcFormulas } from './templateCheck';
import { TemplateError, loadTemplate } from './templates';

export type BuildReportInput = {
  template: ArrayBuffer | Uint8Array;
  kind: ReportKind;
  rows: readonly ReportRow[];
  checks: readonly CheckResult[];
  facts: readonly FactRow[];
  /** Doctor id -> display name, for the Data sheet. */
  doctorNames: ReadonlyMap<string, string>;
};

export type BuiltReport = { bytes: Uint8Array; fill: FillResult };

/**
 * Fill the template. Refuses (with a plain message) if the template does not fit or its
 * own formulas disagree with the report: a wrong number must never reach a deliverable.
 */
export async function buildReport(input: BuildReportInput): Promise<BuiltReport> {
  const table = await loadTemplate(input.template, input.kind);
  if (table.missing.length > 0) {
    throw new TemplateError(`The template has no column for: ${table.missing.join(', ')}. Use the original template.`);
  }

  // The self-check runs on the untouched template, before anything is written.
  const check = verifyCalcFormulas(table, input.kind, input.rows);
  if (check.unreadable.length > 0 || check.mismatches.length > 0) {
    const first = check.mismatches[0];
    throw new TemplateError(
      check.unreadable.length > 0
        ? `The template's formulas could not be checked: ${check.unreadable[0]}`
        : `The template's formulas give different numbers from the report (for example row ${first?.row}, ${first?.column}). The template may have been changed.`,
    );
  }

  const fill = fillTable(table, input.kind, input.rows);
  addChecksSheet(table.workbook, input.checks);
  addDataSheet(table.workbook, input.facts, input.doctorNames);
  // Ask Excel to recalculate on open; the cached results written above already match.
  table.workbook.calcProperties.fullCalcOnLoad = true;

  const buffer = await table.workbook.xlsx.writeBuffer();
  return { bytes: new Uint8Array(buffer as ArrayBuffer), fill };
}

/** DRR_2026-10_run1.xlsx / Sponsorwise_2026-10_run1.xlsx */
export function reportFileName(kind: ReportKind, month: string, runNumber: number): string {
  return `${kind === 'drr' ? 'DRR' : 'Sponsorwise'}_${month}_run${runNumber}.xlsx`;
}
