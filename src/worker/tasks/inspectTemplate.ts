// inspectTemplate task: open an Excel template and say where the report would go: sheets, header row, and how each
// report column maps to a template column (matched / formula kept / not found). Writes nothing.

import { inspectTemplate, openTemplateWorkbook, TemplateError, type TemplateMappingEntry, type TemplateOutput } from '@/excel/fillTemplate';
import { base64ToBytes } from '@/lib/base64';

export type InspectTemplateRequest = {
  templateBase64: string;
  /** The template settings from the recipe (templateBase64 inside it is ignored). */
  output: TemplateOutput;
  reportColumns: string[];
};

export type InspectTemplateResult =
  | { ok: true; sheets: string[]; sheet: string; headerRow: number; firstDataRow: number; lastTemplateRow: number; mapping: TemplateMappingEntry[] }
  | { ok: false; sheets: string[]; message: string };

export async function inspectTemplateTask(req: InspectTemplateRequest): Promise<InspectTemplateResult> {
  let workbook;
  try {
    workbook = await openTemplateWorkbook(base64ToBytes(req.templateBase64));
  } catch (err) {
    return { ok: false, sheets: [], message: err instanceof TemplateError ? err.message : 'The template could not be read.' };
  }
  const sheets = workbook.worksheets.map((s) => s.name);
  try {
    const t = inspectTemplate(workbook, req.output, req.reportColumns);
    return { ok: true, sheets, sheet: t.sheet.name, headerRow: t.headerRow, firstDataRow: t.firstDataRow, lastTemplateRow: t.lastTemplateRow, mapping: t.mapping };
  } catch (err) {
    if (err instanceof TemplateError) return { ok: false, sheets, message: err.message };
    throw err;
  }
}
