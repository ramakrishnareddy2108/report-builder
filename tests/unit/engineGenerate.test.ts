import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { cleanup } from '@/engine/cleanup';
import { generate, type GenerateInput } from '@/engine/generate';
import { runLookups } from '@/engine/lookups';
import { buildReport } from '@/engine/report';
import type { CombinedTable } from '@/engine/types';
import { openWorkbook } from '@/excel/readWorkbook';
import { bytesToBase64 } from '@/lib/base64';
import type { Recipe } from '@/recipe/schema';
import { exportCombinedTask, generateTask } from '@/worker/tasks/generate';
import { files, PARAMS, recipe, SOURCES } from '../helpers/syntheticRecipe';
import { asFile, hisWorkbook } from '../helpers/syntheticWorkbook';

const input = (r: Recipe, opts: Parameters<typeof files>[0] = {}): GenerateInput => ({
  recipe: r,
  params: PARAMS,
  files: files(opts).map((f) => ({ sourceId: f.sourceId, fileName: f.fileName, workbook: openWorkbook(f.bytes) })),
});

const rows = (r: Awaited<ReturnType<typeof generate>>) => r.report?.rows ?? [];

describe('end to end: synthetic month', () => {
  it('produces exact paise totals per doctor and in the totals row', async () => {
    const r = await generate(input(recipe()));
    expect(r.canDownload).toBe(true);
    expect(rows(r).map((x) => [x['S.No.'], x['Doctor Name'], x.Department, x.Month])).toEqual([
      [1, 'Dr A Kumar', 'Cardiology', 'Oct-2026'],
      [2, 'Dr B Rao', 'Neurology', 'Oct-2026'],
      [3, 'Pharmacy – Unattributed', 'Pharmacy – Unattributed', 'Oct-2026'],
    ]);
    const money = (x: Record<string, unknown>) => ({
      op: x['OP Revenue'], ph: x['OP Pharmacy'], total: x['Total Revenue'], cost: x['OP Pharmacy Cost'], sal: x['Salary Cost'], gp: x['Gross Profit'],
    });
    expect(money(rows(r)[0] as Record<string, unknown>)).toEqual({ op: 150015, ph: 15010, total: 165025, cost: 8005, sal: 500000, gp: -342980 });
    expect(money(rows(r)[1] as Record<string, unknown>)).toEqual({ op: 200000, ph: 18990, total: 218990, cost: 9000, sal: 400000, gp: -190010 });
    expect(money(rows(r)[2] as Record<string, unknown>)).toEqual({ op: 0, ph: 7020, total: 7020, cost: 3010, sal: 0, gp: 4010 });
    expect(money(r.report?.totals as Record<string, unknown>)).toEqual({ op: 350015, ph: 41020, total: 391035, cost: 20015, sal: 900000, gp: -528980 });
    expect(r.report?.totals?.['Doctor Name']).toBe('Total');
  });

  it('counts every source row: read, filtered, used, unreadable', async () => {
    const r = await generate(input(recipe()));
    const s = (id: string) => r.sources.find((x) => x.sourceId === id)?.stats;
    expect(s('opBilling')).toMatchObject({ read: 5, filtered: 1, used: 4, unreadableByColumn: { Amount: 1 } });
    expect(s('opPharmacy')).toMatchObject({ read: 5, filtered: 1, used: 4 });
    expect(s('opReturns')).toMatchObject({ read: 2, filtered: 1, used: 1 });
    expect(s('opConsultations')).toMatchObject({ read: 3, filtered: 0, used: 3 });
    expect(r.combined.rows).toHaveLength(4 + 3 + 4 + 1 + 2);
  });

  it('attributes pharmacy rows: matched, nearest later record, not found', async () => {
    const r = await generate(input(recipe()));
    const pharmacy = r.lookups.find((l) => l.label === 'Pharmacy attribution');
    expect(pharmacy?.byStatus).toEqual({ Matched: 2, Fallback: 1, Ambiguous: 0, Unattributed: 1 });
    expect(pharmacy?.amountByStatus).toEqual({ Matched: 30010, Fallback: 5000, Ambiguous: 0, Unattributed: 7020 });
    expect(pharmacy?.notFoundKeys).toEqual(['UMR9']);
    expect(r.lookups.find((l) => l.label === 'Returns attribution')?.byStatus).toEqual({ Matched: 1, Fallback: 0, Ambiguous: 0, Unattributed: 0 });
    const status = r.combined.rows.filter((x) => x.Source === 'OP Pharmacy').map((x) => [x.Ref, x.Doctor, x.Attribution]);
    expect(status).toEqual([
      ['P1', 'Dr A Kumar', 'Matched'],
      ['P1', 'Dr A Kumar', 'Fallback'],
      ['P3', 'Pharmacy – Unattributed', 'Unattributed'],
      ['P5', 'Dr B Rao', 'Matched'],
    ]);
  });

  it('reports every kind of leftover in the Checks, none silently', async () => {
    const r = await generate(input(recipe()));
    const titles = r.checks.map((c) => `${c.level}: ${c.title}`);
    expect(titles).toContain('warning: OP Billing: unreadable Amount');
    expect(titles).toContain('warning: Lookup: Pharmacy attribution');
    expect(titles).toContain('info: Tie-out: OP Billing total');
    expect(titles).toContain('info: Names cleaned: Doctor');
    const unreadable = r.checks.find((c) => c.title === 'OP Billing: unreadable Amount');
    expect(unreadable?.details).toEqual([{ file: 'OP Billing Report Oct2026.xlsx', row: 7, text: '“oops” is not a valid value' }]);
    const rowsCheck = r.checks.find((c) => c.title === 'OP Billing: rows');
    expect(rowsCheck?.message).toMatch(/5 rows read.*1 row left out by the row filter \(this includes footer \/ total rows\); 4 rows used/);
    const unattributed = r.checks.find((c) => c.title === 'Lookup: Pharmacy attribution');
    expect(unattributed?.amountPaise).toBe(7020);
    // warnings come before info
    const levels = r.checks.map((c) => c.level).join(',');
    expect(levels).toMatch(/^(warning,)+(info,)*info$/);
  });

  it('a tie-out that does not match is a warning with both totals (the report side is what that source added to the column)', async () => {
    const r2 = recipe();
    r2.checks.tieOuts = [{ label: 'Pharmacy vs billing', source: 'opBilling', column: 'Amount', reportColumn: 'OP Pharmacy', tolerance: 0.01 }];
    const r = await generate(input(r2));
    const c = r.checks.find((x) => x.title === 'Tie-out: Pharmacy vs billing');
    expect(c?.level).toBe('warning');
    // OP Billing adds nothing to the OP Pharmacy column, so the report side of this comparison is ₹0.00
    expect(c?.message).toMatch(/₹3,500\.15.*₹0\.00/);
  });

  it('writes a plain workbook with Checks and Combined sheets, money in rupees', async () => {
    const r2 = recipe();
    r2.output = { mode: 'plain', sheetName: 'DRR', includeChecksSheet: true, includeCombinedSheet: true };
    const r = await generate(input(r2));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.workbookBytes as unknown as ArrayBuffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['DRR', 'Checks', 'Combined']);
    const sheet = wb.getWorksheet('DRR');
    expect(sheet?.getRow(1).values).toEqual([undefined, 'S.No.', 'Doctor Name', 'Department', 'Month', 'OP Revenue', 'OP Pharmacy', 'Total Revenue', 'OP Pharmacy Cost', 'Salary Cost', 'Gross Profit']);
    expect(sheet?.getRow(2).getCell(5).value).toBe(1500.15);
    expect(sheet?.getRow(5).getCell(2).value).toBe('Total');
    expect(sheet?.getRow(5).getCell(10).value).toBe(-5289.8);
    expect(wb.getWorksheet('Combined')?.rowCount).toBe(1 + r.combined.rows.length);
  });

  it('escapes text that starts with = + - or @', async () => {
    const r2 = recipe();
    r2.cleanup = []; // keep the spelling
    // a doctor whose name starts with "=": Excel must not run it as a formula
    const evil = hisWorkbook('Sheet1', ['BILLNO', 'BILLDT', 'UMRNO', 'DOCTORNAME', 'DEPARTMENTNAME', 'NETAMOUNT'], [['B1', '02-OCT-2026', 'UMR1', '=HYPERLINK("x")', 'Cardiology', 10]]);
    const base = input(r2);
    const r = await generate({ ...base, files: base.files.map((x) => (x.sourceId === 'opBilling' ? { ...x, workbook: openWorkbook(evil) } : x)) });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.workbookBytes as unknown as ArrayBuffer);
    const names = (wb.getWorksheet('Report')?.getColumn(2).values ?? []).map(String);
    expect(names.some((n) => n.startsWith("'=HYPERLINK"))).toBe(true);
    expect(names.some((n) => n.startsWith('=HYPERLINK'))).toBe(false);
  });

  it('an optional source without a file leaves its columns at zero and is noted', async () => {
    const r = await generate(input(recipe(), { withCosts: false }));
    expect(r.canDownload).toBe(true);
    expect(rows(r).every((x) => x['Salary Cost'] === 0)).toBe(true);
    expect(r.checks.some((c) => c.level === 'info' && /Costs: optional source, no file added/.test(c.message))).toBe(true);
  });

  it('uploaded files that no source used are listed as a warning, not dropped silently', async () => {
    const r = await generate({ ...input(recipe()), ignoredFiles: ['IP Admissions report oct2026.xlsx'] });
    expect(r.canDownload).toBe(true);
    const c = r.checks.find((x) => x.title === 'Files not used');
    expect(c?.level).toBe('warning');
    expect(c?.message).toBe('1 uploaded file did not match any source and was not used: IP Admissions report oct2026.xlsx. If one of them should be in the report, say what it is on the Generate page.');
  });

  it('a missing column blocks the download and names the source and column', async () => {
    const r2 = recipe();
    r2.sources = r2.sources.map((s) => (s.id === 'opBilling' ? { ...s, columns: s.columns.map((c) => (c.from === 'NETAMOUNT' ? { ...c, from: 'NET AMOUNT' } : c)) } : s));
    const r = await generate(input(r2));
    expect(r.canDownload).toBe(false);
    expect(r.workbookBytes).toBeNull();
    expect(r.report).toBeNull();
    expect(r.checks[0]).toMatchObject({ level: 'error', message: 'OP Billing: column NET AMOUNT not found. Pick the new column in Sources.' });
  });

  it('a missing required file and an empty parameter are errors', async () => {
    const r = await generate({ ...input(recipe()), files: [], params: { Month: ' ' } });
    expect(r.canDownload).toBe(false);
    const messages = r.checks.filter((c) => c.level === 'error').map((c) => c.message);
    expect(messages).toContain('Enter a value for “Report month (e.g. Oct-2026)”.');
    expect(messages.some((m) => /OP Billing: no file was added/.test(m))).toBe(true);
  });

  it('template mode without an uploaded template is a clear error', async () => {
    const r2 = recipe();
    r2.output = { mode: 'template', templateName: 'DRR Format.xlsx', templateBase64: '', headerRow: 4, keepTemplateFormulas: true, includeChecksSheet: true, includeCombinedSheet: false };
    const r = await generate(input(r2));
    expect(r.canDownload).toBe(false);
    expect(r.checks[0]?.message).toMatch(/No template has been added.*DRR Format\.xlsx/);
  });
});

describe('worker generate task', () => {
  it('runs the pipeline from uploaded files, with progress, and keeps the combined data for export', async () => {
    const stages: string[] = [];
    const r = await generateTask(
      { recipe: recipe(), params: PARAMS, assignments: files().map((f) => ({ sourceId: f.sourceId, file: asFile(f.bytes, f.fileName) })) },
      (p) => stages.push(p.stage),
    );
    expect(r.canDownload).toBe(true);
    expect(r.report?.rows).toHaveLength(3);
    expect(r.combinedRows).toBe(14);
    expect(r.combinedPreview.rows.length).toBeLessThanOrEqual(200);
    expect(stages.at(-1)).toBe('Done');

    const bytes = await exportCombinedTask();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    expect(wb.getWorksheet('Combined')?.rowCount).toBe(15);
  });
});

// ---- focused engine pieces -------------------------------------------------------------------

const table = (names: string[], data: (string | number | null)[][], types: Record<string, 'text' | 'money' | 'number' | 'date'> = {}): CombinedTable => ({
  columns: names.map((n) => ({ name: n, type: types[n] ?? 'text' })),
  rows: data.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i] ?? null]))),
});

describe('cleanup', () => {
  const rule = { column: 'Doctor', normalize: { trim: true as const, collapseSpaces: true as const, ignoreCase: true, removeChars: '.,' }, displayCase: 'title' as const, aliases: [] };

  it('groups spellings, writes the most common one in title case, and reports raw → clean', () => {
    const t = table(['Doctor'], [['Dr. A  Kumar'], ['dr a kumar'], ['DR A KUMAR'], ['dr a kumar'], [null], ['Dr B Rao']]);
    const r = cleanup(t, [rule]);
    expect(t.rows.map((x) => x.Doctor)).toEqual(['Dr A Kumar', 'Dr A Kumar', 'Dr A Kumar', 'Dr A Kumar', null, 'Dr B Rao']);
    expect(r.reports[0]).toMatchObject({ rawNames: 4, cleanNames: 2, blankRows: 1 });
    expect(r.reports[0]?.mappings).toContainEqual({ raw: 'dr a kumar', clean: 'Dr A Kumar', count: 2 });
    expect(r.reports[0]?.unmatchedByAlias.map((u) => u.name)).toEqual(['Dr A Kumar', 'Dr B Rao']);
  });

  it('aliases join names that normalising cannot', () => {
    const t = table(['Doctor'], [['Dr Anil Kumar'], ['DR ANILKUMAR'], ['Dr A Kumar'], ['Dr B Rao']]);
    const r = cleanup(t, [{ ...rule, aliases: [{ to: 'Dr Anil Kumar', from: ['Dr. Anilkumar'] }] }]);
    expect(t.rows.map((x) => x.Doctor)).toEqual(['Dr Anil Kumar', 'Dr Anil Kumar', 'Dr A Kumar', 'Dr B Rao']); // "Dr A Kumar" is not in an alias: left separate, and listed
    expect(r.reports[0]?.unmatchedByAlias.map((u) => u.name).sort()).toEqual(['Dr A Kumar', 'Dr B Rao']);
    expect(r.reports[0]?.mappings).toContainEqual({ raw: 'DR ANILKUMAR', clean: 'Dr Anil Kumar', count: 1 });
  });

  it('keeps case with asIs and a rule on a missing column is an error', () => {
    const t = table(['Sponsor'], [['star health '], ['STAR HEALTH']]);
    cleanup(t, [{ ...rule, column: 'Sponsor', displayCase: 'asIs' }]);
    expect(t.rows.map((x) => x.Sponsor)).toEqual(['star health', 'star health']);
    expect(cleanup(t, [{ ...rule, column: 'Nope' }]).issues[0]?.message).toMatch(/column Nope does not exist/);
  });
});

describe('lookups', () => {
  const sources = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] as never;
  const make = () =>
    table(
      ['Source', 'Key', 'Date', 'Doctor', 'Dept', 'Adm'],
      [
        ['B', 'K1', '2026-10-02', 'Dr One', 'D1', null],
        ['B', 'K1', '2026-10-10', 'Dr Two', 'D2', null],
        ['B', 'k2', '2026-10-05', 'Dr Three', 'D3', null],
        ['A', 'K1', '2026-10-02', null, null, null], //   same day: on or before → Dr One
        ['A', 'K1', '2026-10-09', null, null, null], //   → Dr One
        ['A', 'K1', '2026-10-10', null, null, null], //   same day → Dr Two
        ['A', 'K1', '2026-09-30', null, null, null], //   before all → nearest later: Dr One (Fallback)
        ['A', ' K2 ', '2026-10-06', null, null, null], //  key ignores spaces and case → Dr Three
        ['A', 'K3', '2026-10-06', null, null, null], //   not found
        ['A', null, '2026-10-06', null, null, null], //   blank key: not found, counted
        ['A', 'K1', '2026-10-06', null, null, 'ADM1'], // onlyWhen false: untouched
      ],
    );
  const rule = {
    label: 'L',
    target: { source: 'a', column: 'Doctor', key: 'Key', date: 'Date' },
    from: { source: 'b', key: 'Key', value: 'Doctor', date: 'Date', extraValues: [{ from: 'Dept', as: 'Dept' }] },
    onlyWhen: 'ISBLANK([Adm])',
    pick: 'latestOnOrBefore' as const,
    notFoundValue: 'Unattributed',
    writeStatusColumn: 'Status',
  };

  it('picks the latest record on or before the date, by calendar day', () => {
    const t = make();
    const r = runLookups(t, [rule], { sources });
    expect(t.rows.slice(3).map((x) => [x.Doctor, x.Dept, x.Status])).toEqual([
      ['Dr One', 'D1', 'Matched'],
      ['Dr One', 'D1', 'Matched'],
      ['Dr Two', 'D2', 'Matched'],
      ['Dr One', 'D1', 'Fallback'],
      ['Dr Three', 'D3', 'Matched'],
      ['Unattributed', 'Unattributed', 'Unattributed'],
      ['Unattributed', 'Unattributed', 'Unattributed'],
      [null, null, null],
    ]);
    expect(r.results[0]).toMatchObject({ considered: 7, skipped: 1, byStatus: { Matched: 4, Fallback: 1, Unattributed: 2 }, blankKeyRows: 1, notFoundKeys: ['K3'] });
  });

  it('supports first and single', () => {
    const first = make();
    runLookups(first, [{ ...rule, pick: 'first', target: { ...rule.target, date: undefined }, from: { ...rule.from, date: undefined } }], { sources });
    expect(first.rows[5]?.Doctor).toBe('Dr One');
    const single = make();
    const r = runLookups(single, [{ ...rule, pick: 'single', target: { ...rule.target, date: undefined }, from: { ...rule.from, date: undefined } }], { sources });
    expect(single.rows[5]?.Status).toBe('Fallback'); // K1 has two different doctors
    expect(single.rows[7]?.Status).toBe('Matched'); // K2 has one
    expect(r.results[0]?.byStatus.Fallback).toBeGreaterThan(0);
  });

  it('latestOnOrBefore needs dates on both sides, and unknown columns are errors', () => {
    expect(runLookups(make(), [{ ...rule, target: { ...rule.target, date: undefined } }], { sources }).issues[0]?.message).toMatch(/needs a date column on both sides/);
    expect(runLookups(make(), [{ ...rule, from: { ...rule.from, value: 'Nope' } }], { sources }).issues[0]).toMatchObject({ level: 'error', column: 'Nope' });
    expect(runLookups(make(), [{ ...rule, target: { ...rule.target, source: 'zzz' } }], { sources }).issues[0]?.message).toMatch(/target source “zzz” is not in this recipe/);
  });
});

describe('report', () => {
  const t = table(
    ['Doctor', 'Source', 'Amount', 'Cost', 'Ref'],
    [['A', 'X', 10010, 5, 'r1'], ['A', 'X', 20, null, 'r1'], ['A', 'Y', 5, 5, 'r2'], ['B', 'X', 7, 7, 'r3'], ['b', 'X', 3, 3, 'r4']],
    { Amount: 'money', Cost: 'number' },
  );
  const col = (name: string, agg: 'SUM' | 'COUNT' | 'COUNTDISTINCT' | 'AVG' | 'MIN' | 'MAX', of: string | undefined, type: 'money' | 'number' = 'money', where?: string) =>
    ({ kind: 'aggregate' as const, name, agg, of, type, ...(where ? { where } : {}) });

  it('computes every aggregate, in paise for money, and recomputes the totals', () => {
    const r = buildReport(t, {
      groupBy: ['Doctor'],
      totalsRow: true,
      columns: [
        { kind: 'group', name: 'Doctor', from: 'Doctor' },
        col('Sum', 'SUM', 'Amount'),
        col('SumX', 'SUM', 'Amount', 'money', '[Source]="X"'),
        col('Count', 'COUNT', undefined, 'number'),
        col('CountCost', 'COUNT', 'Cost', 'number'),
        col('Distinct', 'COUNTDISTINCT', 'Ref', 'number'),
        col('Avg', 'AVG', 'Amount'),
        col('Min', 'MIN', 'Amount'),
        col('Max', 'MAX', 'Amount'),
      ],
    });
    expect(r.issues).toEqual([]);
    const a = r.rows.find((x) => x.Doctor === 'A');
    expect(a).toMatchObject({ Sum: 10035, SumX: 10030, Count: 3, CountCost: 2, Distinct: 2, Avg: 3345, Min: 5, Max: 10010 });
    expect(r.rows.map((x) => x.Doctor)).toEqual(['A', 'B', 'b']); // no case folding in group-by: that is the cleanup step's job
    expect(r.totals).toMatchObject({ Doctor: 'Total', Sum: 10045, SumX: 10040, Count: 5, Distinct: 4, Avg: 2009, Min: 3, Max: 10010 });
  });

  it('formula columns work on the same row (rupees in, paise out), in dependency order, and errors are counted', () => {
    const r = buildReport(t, {
      groupBy: ['Doctor'],
      totalsRow: true,
      sort: [{ column: 'Doctor', dir: 'desc' }],
      columns: [
        { kind: 'serial', name: 'No' },
        { kind: 'group', name: 'Doctor', from: 'Doctor' },
        { kind: 'formula', name: 'Net', formula: '[Gross]-1', type: 'money' }, // uses a formula column declared later
        { kind: 'formula', name: 'Gross', formula: '[Sum]+0.5', type: 'money' },
        col('Sum', 'SUM', 'Amount'),
        { kind: 'formula', name: 'Ratio', formula: '[Sum]/[Zero]', type: 'number' },
        col('Zero', 'COUNT', 'Cost', 'number', '[Source]="nothing"'),
        { kind: 'formula', name: 'Safe', formula: 'IFERROR([Sum]/[Zero], 0)', type: 'number' },
      ],
    });
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ level: 'warning', column: 'Ratio' });
    expect(r.rows.map((x) => [x.No, x.Doctor, x.Gross, x.Net, x.Ratio, x.Safe])).toEqual([
      [1, 'B', 57, -43, null, 0], // "B" and "b" tie when sorting (case ignored): data order decides
      [2, 'b', 53, -47, null, 0],
      [3, 'A', 10085, 9985, null, 0],
    ]);
    expect(r.totals).toMatchObject({ Sum: 10045, Gross: 10095, Net: 9995 }); // formulas recomputed on the totals
  });

  it('sorts by the chosen column and defaults to the group-by order', () => {
    const cols = [{ kind: 'group' as const, name: 'Doctor', from: 'Doctor' }, col('Sum', 'SUM', 'Amount')];
    expect(buildReport(t, { groupBy: ['Doctor'], totalsRow: false, columns: cols, sort: [{ column: 'Sum', dir: 'desc' }] }).rows.map((x) => x.Doctor)).toEqual(['A', 'B', 'b']);
    expect(buildReport(t, { groupBy: ['Doctor'], totalsRow: false, columns: cols, sort: [] }).rows.map((x) => x.Doctor)).toEqual(['A', 'B', 'b']);
    expect(buildReport(t, { groupBy: ['Doctor'], totalsRow: false, columns: cols }).totals).toBeNull();
  });

  it('blocks on a bad definition with plain messages', () => {
    const bad = (columns: Parameters<typeof buildReport>[1]['columns'], groupBy = ['Doctor']) => buildReport(t, { groupBy, totalsRow: false, columns }).issues.map((i) => i.message);
    expect(bad([col('S', 'SUM', 'Nope')])[0]).toMatch(/column Nope, which was not found/);
    expect(bad([col('S', 'SUM', 'Ref')])[0]).toMatch(/SUM needs a number or money column, but Ref is text/);
    expect(bad([col('S', 'SUM', undefined)])[0]).toMatch(/needs a column to sum/);
    expect(bad([col('S', 'SUM', 'Amount', 'money', '[Source] =')])[0]).toMatch(/filter is not a valid formula/);
    expect(bad([col('S', 'SUM', 'Amount', 'money', '[Missing]="x"')])[0]).toMatch(/\[Missing\]/);
    expect(bad([{ kind: 'formula', name: 'F', formula: '[Other]+1', type: 'number' }])[0]).toMatch(/not another column of this report/);
    expect(bad([{ kind: 'formula', name: 'A', formula: '[B]', type: 'number' }, { kind: 'formula', name: 'B', formula: '[A]', type: 'number' }])[0]).toMatch(/in a circle/);
    expect(bad([{ kind: 'group', name: 'D', from: 'Source' }])[0]).toMatch(/not in Group by/);
    expect(bad([col('S', 'SUM', 'Amount'), col('s', 'SUM', 'Amount')])[0]).toMatch(/two report columns are called/);
    expect(bad([col('S', 'SUM', 'Amount')], ['Nope'])[0]).toMatch(/group-by column Nope/);
  });

  it('with no group-by it gives one row of totals', () => {
    const r = buildReport(t, { groupBy: [], totalsRow: false, columns: [col('Sum', 'SUM', 'Amount')] });
    expect(r.rows).toEqual([{ Sum: 10045 }]);
  });
});

describe('sources list', () => {
  it('the synthetic recipe has the five sources', () => expect(SOURCES.map((s) => s.id)).toHaveLength(5));
});

// ---- template mode ----------------------------------------------------------------------------

async function templateBytes(opts: { preRows: number; wrongFormula?: boolean }): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Report');
  ws.getCell('A1').value = 'DRR';
  ws.getCell('G2').value = { formula: 'SUBTOTAL(9,G5:G7)', result: 0 }; // too short on purpose
  const headers = ['S.No.', 'Doctor Name', 'Department', 'Month', 'OP Revenue', 'OP Pharmacy', 'Total Revenue', 'OP Pharmacy Cost', 'Salary Cost', 'Gross Profit'];
  headers.forEach((h, i) => (ws.getRow(4).getCell(i + 1).value = h));
  for (let r = 5; r < 5 + opts.preRows; r++) {
    ws.getRow(r).getCell(1).value = r - 4;
    ws.getRow(r).getCell(7).value = { formula: opts.wrongFormula ? `E${r}+F${r}+H${r}` : `E${r}+F${r}`, result: 0 };
    ws.getRow(r).getCell(10).value = { formula: `G${r}-H${r}-I${r}`, result: 0 };
    ws.getRow(r).getCell(5).numFmt = '#,##0.00';
  }
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

async function filled(bytes: Uint8Array, keep = true) {
  const r2 = recipe();
  r2.output = { mode: 'template', templateName: 'DRR Format.xlsx', templateBase64: bytesToBase64(bytes), headerRow: 'auto', keepTemplateFormulas: keep, includeChecksSheet: false, includeCombinedSheet: false };
  const r = await generate(input(r2));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(r.workbookBytes as unknown as ArrayBuffer);
  return { r, ws: wb.getWorksheet('Report') as ExcelJS.Worksheet };
}

describe('template fill', () => {
  it('writes from the first row under the header, keeps formulas, clears unused pre-numbered rows', async () => {
    const { r, ws } = await filled(await templateBytes({ preRows: 6 }));
    expect(r.canDownload).toBe(true);
    expect(ws.getRow(5).getCell(2).value).toBe('Dr A Kumar');
    expect(ws.getRow(5).getCell(5).value).toBe(1500.15);
    // the Total Revenue formula stays and carries the engine's value as its cached result
    expect(ws.getRow(5).getCell(7).value).toMatchObject({ formula: 'E5+F5', result: 1650.25 });
    expect(ws.getRow(5).getCell(10).value).toMatchObject({ formula: 'G5-H5-I5', result: -3429.8 });
    // 3 data rows; rows 8, 9, 10 are cleared but keep their formulas and formatting
    expect(ws.getRow(8).getCell(1).value).toBeNull();
    expect(ws.getRow(8).getCell(2).value).toBeNull();
    expect(ws.getRow(8).getCell(7).value).toMatchObject({ formula: 'E8+F8' });
    expect(ws.getRow(8).getCell(5).numFmt).toBe('#,##0.00');
    expect(r.templateMapping?.map((m) => m.status)).toEqual(['matched', 'matched', 'matched', 'matched', 'matched', 'matched', 'formula-kept', 'matched', 'matched', 'formula-kept']);
    expect(r.checks.some((c) => c.title === 'Template' && /Extend the SUBTOTAL range/.test(c.message))).toBe(false); // data ends on row 7
  });

  it('extends formatting and formula patterns when the data has more rows than the template', async () => {
    const { r, ws } = await filled(await templateBytes({ preRows: 2 }));
    expect(ws.getRow(7).getCell(2).value).toBe('Pharmacy – Unattributed');
    expect(ws.getRow(7).getCell(7).value).toMatchObject({ formula: 'E7+F7', result: 70.2 });
    expect(ws.getRow(7).getCell(5).numFmt).toBe('#,##0.00'); // copied from the last pre-made row
    expect(r.canDownload).toBe(true);
  });

  it('warns when a SUBTOTAL range is too short for the data', async () => {
    const bytes = await templateBytes({ preRows: 6 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    wb.getWorksheet('Report')!.getCell('G2').value = { formula: 'SUBTOTAL(9,G5:G6)', result: 0 };
    const out = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const { r } = await filled(out);
    const note = r.checks.find((c) => c.title === 'Template' && /Extend the SUBTOTAL range/.test(c.message));
    expect(note?.level).toBe('warning');
  });

  it('cross-check: a template formula that differs from the recipe formula is a warning', async () => {
    const { r } = await filled(await templateBytes({ preRows: 6, wrongFormula: true }));
    const note = r.checks.find((c) => c.title === 'Template' && /Total Revenue/.test(c.message));
    expect(note?.level).toBe('warning');
    expect(note?.message).toMatch(/gives a different result from the report on 3 rows/);
    expect(r.canDownload).toBe(true); // a warning, not an error
  });

  it('without keepTemplateFormulas the formula columns are overwritten with values', async () => {
    const { ws, r } = await filled(await templateBytes({ preRows: 6 }), false);
    expect(ws.getRow(5).getCell(7).value).toBe(1650.25);
    expect(r.templateMapping?.every((m) => m.status === 'matched')).toBe(true);
  });

  it('a template that does not match the report is an error naming what is wrong', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Report').getCell('A1').value = 'nothing here';
    const bytes = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const r2 = recipe();
    r2.output = { mode: 'template', templateName: 't.xlsx', templateBase64: bytesToBase64(bytes), headerRow: 'auto', keepTemplateFormulas: true, includeChecksSheet: false, includeCombinedSheet: false };
    const r = await generate(input(r2));
    expect(r.canDownload).toBe(false);
    expect(r.checks[0]?.message).toMatch(/has any of the report's column names/);
  });

  it('report columns the template lacks are listed as warnings', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Report');
    ['Doctor Name', 'OP Revenue'].forEach((h, i) => (ws.getRow(1).getCell(i + 1).value = h));
    const bytes = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const { r, ws: out } = await filled(bytes);
    expect(r.checks.filter((c) => c.title === 'Template' && /has no column/.test(c.message))).toHaveLength(8);
    expect(out.getRow(2).getCell(1).value).toBe('Dr A Kumar');
  });
});

describe('shiftFormulaRows', () => {
  it('moves relative rows, keeps absolute ones, and leaves function names alone', async () => {
    const { shiftFormulaRows } = await import('@/excel/fillTemplate');
    expect(shiftFormulaRows('E5+F5', 2)).toBe('E7+F7');
    expect(shiftFormulaRows('+I5-J5-L5', 1)).toBe('+I6-J6-L6');
    expect(shiftFormulaRows('$A$1+B5', 3)).toBe('$A$1+B8');
    expect(shiftFormulaRows('LOG10(E5)', 1)).toBe('LOG10(E6)');
    expect(shiftFormulaRows('SUM(E5:E6)', 1)).toBe('SUM(E6:E7)');
  });
});
