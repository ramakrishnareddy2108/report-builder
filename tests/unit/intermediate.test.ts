import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { generate } from '@/engine/generate';
import { intermediateSheets } from '@/engine/intermediate';
import { intermediateWorkbookBytes } from '@/engine/output';
import { openWorkbook } from '@/excel/readWorkbook';
import { files, PARAMS, recipe } from '../helpers/syntheticRecipe';

async function run() {
  const r = recipe();
  const result = await generate({ recipe: r, params: PARAMS, files: files().map((f) => ({ sourceId: f.sourceId, fileName: f.fileName, workbook: openWorkbook(f.bytes) })) });
  return { r, result };
}

describe('intermediate workbook', () => {
  it('has one sheet per source holding only the selected columns, with every kept row', async () => {
    const { r, result } = await run();
    const sheets = intermediateSheets(result.combined, r, result.sources);
    expect(sheets.map((s) => s.sourceId)).toEqual(r.sources.map((s) => s.id));
    for (const s of sheets) {
      const def = r.sources.find((d) => d.id === s.sourceId);
      const selected = [...(def?.columns ?? []).map((c) => c.as), ...(def?.calculated ?? []).map((c) => c.as)];
      for (const name of selected) expect(s.columns.map((c) => c.name)).toContain(name);
      // nothing from another source, no app columns except the Excel row number
      expect(s.columns.map((c) => c.name)).not.toContain('Source');
      expect(s.columns.map((c) => c.name)).not.toContain('_file');
      expect(s.columns.map((c) => c.name)).toContain('_row');
    }
    expect(sheets.reduce((n, s) => n + s.rows.length, 0)).toBe(result.combined.rows.length);
    // lookup output lands on the sheet of the source it was written on
    const pharmacy = sheets.find((s) => s.sourceId === 'opPharmacy');
    expect(pharmacy?.columns.map((c) => c.name)).toEqual(expect.arrayContaining(['Doctor', 'Attribution']));
  });

  it('writes a Summary sheet then one sheet per source, money in rupees', async () => {
    const { r, result } = await run();
    const bytes = await intermediateWorkbookBytes(result.combined, r, result.sources);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Summary', ...r.sources.map((s) => s.label)]);
    const summary = wb.getWorksheet('Summary');
    expect(summary?.rowCount).toBe(1 + r.sources.length);
    const billing = wb.getWorksheet('OP Billing');
    expect(billing?.rowCount).toBe(1 + (result.sources.find((s) => s.sourceId === 'opBilling')?.stats.used ?? -1));
    const header = (billing?.getRow(1).values as unknown[]).slice(1);
    const amountCol = header.indexOf('Amount') + 1;
    const amounts: unknown[] = [];
    billing?.eachRow((row, n) => {
      if (n > 1) amounts.push(row.getCell(amountCol).value);
    });
    expect(amounts).toEqual([1000.1, 500.05, 2000, null]); // bills, in rupees; the unreadable one stays blank (and is listed in Checks)
  });

  it('can be made even when the report is blocked by an error', async () => {
    const r = recipe();
    r.report.columns = [...r.report.columns, { kind: 'formula', name: 'Broken', formula: '[Nope]+1', type: 'money' }];
    const result = await generate({ recipe: r, params: PARAMS, files: files().map((f) => ({ sourceId: f.sourceId, fileName: f.fileName, workbook: openWorkbook(f.bytes) })) });
    expect(result.canDownload).toBe(false);
    const bytes = await intermediateWorkbookBytes(result.combined, r, result.sources);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    expect(wb.getWorksheet('OP Billing')?.rowCount).toBeGreaterThan(1);
  });
});
