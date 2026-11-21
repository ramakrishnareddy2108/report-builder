import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '@/lib/base64';
import { blankRecipe } from '@/recipe/blank';
import { checkRecipe, hasProblems } from '@/recipe/validate';
import { inspectTemplateTask } from '@/worker/tasks/inspectTemplate';
import { recipe } from '../helpers/syntheticRecipe';

const messages = (r = recipe()) => checkRecipe(r).filter((p) => p.level === 'error').map((p) => `${p.tab}: ${p.message}`);

describe('checkRecipe', () => {
  it('a complete recipe has no problems', () => {
    expect(checkRecipe(recipe())).toEqual([]);
    expect(hasProblems(checkRecipe(recipe()))).toBe(false);
  });

  it('a blank recipe says what is missing, tab by tab', () => {
    const m = messages(blankRecipe());
    expect(m).toContain('sources: Add at least one source: choose sample files in 1 Sources.');
    expect(m).toContain('report: The report has no columns yet. Add some in 3 Report.');
  });

  it('finds invalid formulas in sources, lookups and the report', () => {
    const r = recipe();
    r.sources[0]!.rowFilter = 'NOT(';
    r.lookups[0]!.onlyWhen = 'ISBLANK([Nope])';
    r.report.columns.push({ kind: 'formula', name: 'Bad', formula: '[Nope]+1', type: 'number' });
    const m = messages(r);
    expect(m.some((x) => x.startsWith('sources: OP Billing: the row filter is not valid'))).toBe(true);
    expect(m.some((x) => x.includes('only when') && x.includes('[Nope]'))).toBe(true);
    expect(m.some((x) => x.startsWith('report: ') && x.includes('“Bad”: the formula uses [Nope]'))).toBe(true);
  });

  it('finds unknown group-by, sort and cleanup columns', () => {
    const r = recipe();
    r.report.groupBy.push('Nope');
    r.report.sort = [{ column: 'Nope', dir: 'asc' }];
    r.cleanup.push({ column: 'Nope', normalize: { trim: true, collapseSpaces: true, ignoreCase: true, removeChars: '' }, displayCase: 'asIs', aliases: [] });
    const m = messages(r);
    expect(m.some((x) => x.includes('group-by column Nope'))).toBe(true);
    expect(m.some((x) => x.includes('sorting by “Nope”'))).toBe(true);
    expect(m.some((x) => x.startsWith('prepare: Name cleanup: column Nope'))).toBe(true);
  });

  it('flags a source with no columns, repeated names, and two sources with one name', () => {
    const r = recipe();
    r.sources[0]!.columns = [];
    r.sources[1]!.columns.push({ from: 'X', as: 'doctor', type: 'text' });
    r.sources[2]!.label = 'OP Billing';
    const m = messages(r);
    expect(m.some((x) => x.includes('OP Billing: no columns are picked'))).toBe(true);
    expect(m.some((x) => x.includes('two columns have the same name'))).toBe(true);
    expect(m.some((x) => x.includes('Two sources are called “OP Billing”'))).toBe(true);
  });

  it('template mode needs a template; a bad tie-out is an error', () => {
    const r = recipe();
    r.output = { mode: 'template', templateName: 'DRR Format.xlsx', templateBase64: '', headerRow: 'auto', keepTemplateFormulas: true, includeChecksSheet: true, includeCombinedSheet: false };
    r.checks.tieOuts.push({ label: 'T', source: 'zzz', column: 'Amount', reportColumn: 'Nope', tolerance: 1 });
    const m = messages(r);
    expect(m).toContain('output: No template has been added. Upload the Excel template in 4 Output, or choose a plain sheet.');
    expect(m.some((x) => x.includes('uses a source that is not in this recipe'))).toBe(true);
    expect(m.some((x) => x.includes('report column “Nope”, which does not exist'))).toBe(true);
  });

  it('empty names are reported (the schema)', () => {
    const r = recipe();
    r.name = '';
    expect(messages(r).some((x) => x.startsWith('sources: Some fields are empty'))).toBe(true);
  });
});

describe('inspectTemplateTask', () => {
  async function template() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Report');
    ['S.No.', 'Doctor Name', 'Total Revenue'].forEach((h, i) => (ws.getRow(4).getCell(i + 1).value = h));
    ws.getRow(5).getCell(3).value = { formula: 'B5', result: 0 };
    return bytesToBase64(new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer));
  }
  const output = { mode: 'template' as const, templateName: 't.xlsx', templateBase64: '', headerRow: 'auto' as const, keepTemplateFormulas: true, includeChecksSheet: false, includeCombinedSheet: false };

  it('maps report columns to template headings and flags the ones it lacks', async () => {
    const r = await inspectTemplateTask({ templateBase64: await template(), output, reportColumns: ['S.No.', 'doctor name', 'Total Revenue', 'Gross Profit'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.headerRow).toBe(4);
    expect(r.sheets).toEqual(['Report']);
    expect(r.mapping.map((m) => [m.reportColumn, m.status])).toEqual([['S.No.', 'matched'], ['doctor name', 'matched'], ['Total Revenue', 'formula-kept'], ['Gross Profit', 'unmatched']]);
  });

  it('explains a wrong sheet, a wrong header row and a file that is not Excel', async () => {
    const t = await template();
    expect(await inspectTemplateTask({ templateBase64: t, output: { ...output, sheetName: 'Nope' }, reportColumns: ['S.No.'] })).toMatchObject({ ok: false, message: expect.stringContaining('no sheet called “Nope”') });
    expect(await inspectTemplateTask({ templateBase64: t, output: { ...output, headerRow: 1 }, reportColumns: ['S.No.'] })).toMatchObject({ ok: false, message: expect.stringContaining('Row 1 of the template') });
    expect(await inspectTemplateTask({ templateBase64: bytesToBase64(new TextEncoder().encode('not excel')), output, reportColumns: ['S.No.'] })).toMatchObject({ ok: false });
  });
});
