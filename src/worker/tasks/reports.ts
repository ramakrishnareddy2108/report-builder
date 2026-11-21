// Report tasks (in the worker, because filling a workbook is heavy):
// checkTemplates  - the self-check of the templates' formulas, as Checks
// buildReports    - fill both templates and return the two workbooks
// inspectTemplate - what a template file looks like, before it is saved

import type { ReportKind } from '@/core/measures';
import type { ReportRow } from '@/core/report';
import type { CheckResult, FactRow } from '@/core/types';
import { buildReport, reportFileName } from '@/excel/buildReport';
import { checkTemplate } from '@/excel/templateCheck';
import { TemplateError, loadTemplate } from '@/excel/templates';
import type { TaskProgress } from '../protocol';

export type CheckTemplatesRequest = {
  drr: ArrayBuffer | null;
  sponsor: ArrayBuffer | null;
  drrRows: ReportRow[];
  sponsorRows: ReportRow[];
};

export async function checkTemplatesTask(req: CheckTemplatesRequest): Promise<CheckResult[]> {
  return [await checkTemplate(req.drr, 'drr', req.drrRows), await checkTemplate(req.sponsor, 'sponsor', req.sponsorRows)];
}

export type BuildReportsRequest = {
  month: string;
  runNumber: number;
  drr: ArrayBuffer | null;
  sponsor: ArrayBuffer | null;
  drrRows: ReportRow[];
  sponsorRows: ReportRow[];
  checks: CheckResult[];
  facts: FactRow[];
  /** Doctor id and display name pairs, for the Data sheet. */
  doctorNames: [string, string][];
};

export type BuiltFile = { kind: ReportKind; fileName: string; bytes: Uint8Array; notes: string[] };
export type BuildReportsResult = {
  files: BuiltFile[];
  /** Reports that could not be made, in plain language. */
  errors: { kind: ReportKind; message: string }[];
};

export async function buildReportsTask(req: BuildReportsRequest, onProgress: (p: TaskProgress) => void = () => {}): Promise<BuildReportsResult> {
  const result: BuildReportsResult = { files: [], errors: [] };
  const doctorNames = new Map(req.doctorNames);
  const jobs = [
    { kind: 'drr' as const, template: req.drr, rows: req.drrRows },
    { kind: 'sponsor' as const, template: req.sponsor, rows: req.sponsorRows },
  ];
  for (const [i, job] of jobs.entries()) {
    onProgress({ stage: job.kind === 'drr' ? 'Filling the DRR' : 'Filling the Sponsor-wise report', fraction: i / jobs.length });
    if (job.template === null) {
      result.errors.push({ kind: job.kind, message: 'The template is not in the workspace. Upload it on the Settings page.' });
      continue;
    }
    try {
      const built = await buildReport({ template: job.template, kind: job.kind, rows: job.rows, checks: req.checks, facts: req.facts, doctorNames });
      result.files.push({ kind: job.kind, fileName: reportFileName(job.kind, req.month, req.runNumber), bytes: built.bytes, notes: built.fill.notes });
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      result.errors.push({ kind: job.kind, message: err.message });
    }
  }
  onProgress({ stage: 'Done', fraction: 1 });
  return result;
}

export type InspectTemplateRequest = { kind: ReportKind; bytes: ArrayBuffer };
export type InspectTemplateResult =
  | { ok: true; sheet: string; headerRow: number; firstDataRow: number; lastTemplateRow: number; columns: number }
  | { ok: false; message: string };

/** Does this file look like the template for `kind`? Never throws for a bad file. */
export async function inspectTemplateTask(req: InspectTemplateRequest): Promise<InspectTemplateResult> {
  try {
    const table = await loadTemplate(req.bytes, req.kind);
    if (table.missing.length > 0) {
      return { ok: false, message: `The template has no column for: ${table.missing.join(', ')}. Use the original template.` };
    }
    return { ok: true, sheet: table.sheet.name, headerRow: table.headerRow, firstDataRow: table.firstDataRow, lastTemplateRow: table.lastTemplateRow, columns: table.columns.size };
  } catch (err) {
    if (err instanceof TemplateError) return { ok: false, message: err.message };
    throw err;
  }
}
