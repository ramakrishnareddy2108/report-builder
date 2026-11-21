// Report tasks (in the worker, because filling a workbook is heavy):
// checkTemplates  - the self-check of the templates' formulas, as Checks
// buildReports    - fill both templates and return the two workbooks
// inspectTemplate - what a template file looks like, before it is saved

import type { ReportKind } from '@/core/measures';
import type { ReportRow } from '@/core/report';
import type { CheckResult, FactRow } from '@/core/types';
import { MEASURES, computeMeasure } from '@/core/measures';
import { buildReport, reportFileName } from '@/excel/buildReport';
import { buildCompareWorkbook, type CompareExportInput } from '@/excel/compareSheet';
import { buildTableWorkbook, type TableExportInput } from '@/excel/tableSheet';
import { readReportRows, type ReadReportRow } from '@/excel/readReport';
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

export type ReadReportRequest = { bytes: ArrayBuffer };
export type ReadReportResult =
  | {
      ok: true;
      rows: ReadReportRow[];
      /** Rows whose Total Revenue or Gross Profit in the file differs (by more than Rs 1) from the sum of their parts. */
      inconsistentRows: string[];
    }
  | { ok: false; message: string };

/** Read a filled past DRR. Never throws for a bad file: the message says what is wrong. */
export async function readReportTask(req: ReadReportRequest): Promise<ReadReportResult> {
  try {
    const rows = await readReportRows(req.bytes, 'drr');
    if (!rows) return { ok: false, message: 'The DRR has no filled rows: it looks like an empty template.' };
    const inconsistentRows = rows
      .filter((r) => {
        const inputs = Object.fromEntries(MEASURES.filter((m) => m.kind !== 'calc').map((m) => [m.code, r.values[m.code] ?? 0]));
        return MEASURES.filter((m) => m.kind === 'calc').some((m) => {
          const given = r.values[m.code];
          return given !== undefined && Math.abs(given - computeMeasure(m.code, inputs)) > 100;
        });
      })
      .map((r) => r.name);
    return { ok: true, rows, inconsistentRows };
  } catch (err) {
    if (err instanceof TemplateError) return { ok: false, message: err.message };
    throw err;
  }
}

/** The Compare view as an Excel workbook. */
export async function exportCompareTask(req: CompareExportInput): Promise<Uint8Array> {
  return buildCompareWorkbook(req);
}

/** A table (a dashboard tile's numbers) as an Excel workbook. */
export async function exportTableTask(req: TableExportInput): Promise<Uint8Array> {
  return buildTableWorkbook(req);
}
