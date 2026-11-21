import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { doctorReport, sponsorReport, type ReportRow } from '@/core/report';
import type { RunOutput } from '@/core/runMonth';
import type { CheckResult, CostEntry } from '@/core/types';
import { buildReport, reportFileName } from '@/excel/buildReport';
import { escapeCell, escapeExcelText } from '@/excel/escape';
import { fillTable } from '@/excel/fillTemplate';
import { checkTemplate, verifyCalcFormulas } from '@/excel/templateCheck';
import { TemplateError, loadTemplate } from '@/excel/templates';
import { runMonthTask } from '@/worker/tasks/runMonth';
import { DOCTORS, DR_A, MONTH, monthRequest } from '../helpers/monthFixture';
import { drrTemplate, reopen, sponsorTemplate } from '../helpers/syntheticTemplate';

const costs: CostEntry[] = [{ doctorId: DR_A, amounts: { DEPT_ISSUES: 100000, SALARY: 500000, INCENTIVES: 50000, PROF_FEE: 250000 } }];
const doctorNames = new Map(DOCTORS.map((d) => [d.id, d.displayName]));

let run: RunOutput;
let drrRows: ReportRow[];
let sponsorRows: ReportRow[];
beforeAll(async () => {
  run = await runMonthTask(monthRequest());
  drrRows = doctorReport(run.facts, costs, DOCTORS, MONTH);
  sponsorRows = sponsorReport(run.facts, MONTH);
});

/** More rows than the 6 pre-made ones, by cloning rows with new names. */
const manyRows = (n: number): ReportRow[] =>
  Array.from({ length: n }, (_, i) => ({ ...drrRows[i % drrRows.length]!, key: `k${i}`, sNo: i + 1, name: `Doctor ${i + 1}` }));

const checks: CheckResult[] = [
  { id: 'a', level: 'Warning', title: 'Every doctor name is in the doctor list', message: 'One name is missing', examples: [], rows: 1, details: ['Dr Unknown: 1 row'], note: 'Visiting doctor' },
  { id: 'b', level: 'Pass', title: '=HYPERLINK("x")', message: '-starts with a dash', examples: [] },
];

const num = (v: unknown) => (typeof v === 'object' && v !== null && 'result' in v ? (v as { result: number }).result : (v as number));

describe('escapeExcelText', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+cmd', "'+cmd"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tTab', "'\tTab"],
    ['\rCR', "'\rCR"],
    ['Dr. A Kumar', 'Dr. A Kumar'],
    ['A = B', 'A = B'],
    ['', ''],
  ])('%j → %j', (input, expected) => expect(escapeExcelText(input)).toBe(expected));

  it('leaves numbers, dates and blanks alone', () => {
    expect(escapeCell(-5)).toBe(-5);
    expect(escapeCell(null)).toBeNull();
    expect(escapeCell('=x')).toBe("'=x");
  });
});

describe('finding the table', () => {
  it('finds the header row by names, ignoring case, spaces and column order', async () => {
    const t = await loadTemplate(await drrTemplate({ messyHeaders: true }), 'drr');
    expect(t.headerRow).toBe(4);
    expect(t.firstDataRow).toBe(5);
    expect(t.lastTemplateRow).toBe(10);
    expect(t.columns.get('IP Count')).toBe(5);
    expect(t.missing).toEqual([]);
  });

  it('reports the headers a template lacks, and fill refuses', async () => {
    const t = await loadTemplate(await drrTemplate({ omit: ['Salary Cost'] }), 'drr');
    expect(t.missing).toEqual(['Salary Cost']);
    expect(() => fillTable(t, 'drr', drrRows)).toThrow(/no column for: Salary Cost/);
  });

  it('says plainly when the file is not a template at all', async () => {
    await expect(loadTemplate(new Uint8Array([1, 2, 3]), 'drr')).rejects.toThrow(/could not be read as an Excel workbook/);
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').getRow(3).values = ['Name', 'Amount'];
    await expect(loadTemplate((await wb.xlsx.writeBuffer()) as ArrayBuffer, 'drr')).rejects.toThrow(/No table with the DRR headers/);
  });
});

describe('table fill: DRR', () => {
  it('writes S.No., names, the month, counts and amounts (in rupees) into the input columns', async () => {
    const out = await buildReport({ template: await drrTemplate(), kind: 'drr', rows: drrRows, checks, facts: run.facts, doctorNames });
    const ws = (await reopen(out.bytes)).getWorksheet('Sheet1')!;

    const a = ws.getRow(5);
    expect(a.getCell('A').value).toBe(1);
    expect(a.getCell('B').value).toBe('A Kumar');
    expect(a.getCell('C').value).toBe('Cardiology');
    expect(a.getCell('D').value).toEqual(new Date(Date.UTC(2026, 9, 1))); // 1 Oct 2026, shown as Oct-26
    expect(a.getCell('D').numFmt).toBe('mmm-yy');
    expect(a.getCell('E').value).toBe(2); // IP count
    expect(a.getCell('F').value).toBe(11500.25); // IP revenue in rupees, not paise
    expect(a.getCell('G').value).toBe(400);
    expect(a.getCell('H').value).toBe(120); // OP pharmacy
    expect(a.getCell('J').value).toBe(90); // OP pharmacy cost
    expect(a.getCell('K').value).toBe(1000.1);
    expect(a.getCell('L').value).toBe(600.05);
    expect(a.getCell('M').value).toBe(1000);
    expect(a.getCell('N').value).toBe(5000);
    expect(a.getCell('O').value).toBe(500);
    expect(a.getCell('P').value).toBe(2500);
  });

  it('keeps the template formulas, with results that match the report', async () => {
    const out = await buildReport({ template: await drrTemplate(), kind: 'drr', rows: drrRows, checks, facts: run.facts, doctorNames });
    const ws = (await reopen(out.bytes)).getWorksheet('Sheet1')!;
    const a = ws.getRow(5);
    expect(a.getCell('I').formula).toBe('+F5+G5+H5');
    expect(a.getCell('Q').formula).toBe('+I5-J5-L5-M5-N5-O5-P5');
    expect(num(a.getCell('I').value)).toBeCloseTo(11500.25 + 400 + 120, 2);
    expect(num(a.getCell('Q').value)).toBeCloseTo(drrRows[0]!.values.GROSS_PROFIT / 100, 2);
    expect(ws.getRow(2).getCell('E').formula).toBe('SUBTOTAL(9,E5:E960)'); // totals row untouched
  });

  it('clears the unused pre-numbered rows but keeps their formatting and formulas', async () => {
    const out = await buildReport({ template: await drrTemplate(), kind: 'drr', rows: drrRows, checks, facts: run.facts, doctorNames });
    expect(out.fill).toMatchObject({ rowsWritten: 4, rowsCleared: 2, rowsAdded: 0 });
    const ws = (await reopen(out.bytes)).getWorksheet('Sheet1')!;
    const unused = ws.getRow(10); // the template numbered this one 504
    expect(unused.getCell('A').value).toBeNull();
    expect(unused.getCell('B').value).toBeNull();
    expect(unused.getCell('F').value).toBeNull();
    expect(unused.getCell('F').numFmt).toContain('#,##0'); // format stays
    expect(unused.getCell('I').formula).toBe('+F10+G10+H10');
  });

  it('extends past the pre-made rows, copying the last row\'s style and formula pattern', async () => {
    const out = await buildReport({ template: await drrTemplate(), kind: 'drr', rows: manyRows(12), checks, facts: run.facts, doctorNames });
    expect(out.fill).toMatchObject({ rowsWritten: 12, rowsCleared: 0, rowsAdded: 6 });
    const ws = (await reopen(out.bytes)).getWorksheet('Sheet1')!;
    const last = ws.getRow(16); // 12 rows from row 5
    expect(last.getCell('B').value).toBe('Doctor 12');
    expect(last.getCell('I').formula).toBe('+F16+G16+H16');
    expect(last.getCell('Q').formula).toBe('+I16-J16-L16-M16-N16-O16-P16');
    expect(last.getCell('F').numFmt).toContain('#,##0');
    expect(last.getCell('F').fill).toMatchObject({ fgColor: { argb: 'FFFFFF99' } }); // style of the last pre-made row
    expect(ws.getRow(17).getCell('B').value).toBeNull(); // nothing beyond
  });

  it('warns when the totals row would not cover the data', async () => {
    const out = await buildReport({ template: await drrTemplate({ subtotalEnd: 10 }), kind: 'drr', rows: manyRows(12), checks, facts: run.facts, doctorNames });
    expect(out.fill.notes.join(' ')).toMatch(/only add up to row 10, but the data goes to row 16/);
  });

  it('writes doctor names that start with = + - @ as text, never as a formula', async () => {
    const rows = [{ ...drrRows[0]!, name: '=HYPERLINK("http://x")' }, { ...drrRows[1]!, name: '-Dr Minus' }];
    const out = await buildReport({ template: await drrTemplate(), kind: 'drr', rows, checks, facts: run.facts, doctorNames });
    const ws = (await reopen(out.bytes)).getWorksheet('Sheet1')!;
    expect(ws.getRow(5).getCell('B').value).toBe(`'=HYPERLINK("http://x")`);
    expect(ws.getRow(6).getCell('B').value).toBe("'-Dr Minus");
  });

  it('finds columns that moved, by header text', async () => {
    const out = await buildReport({ template: await drrTemplate({ messyHeaders: true }), kind: 'drr', rows: drrRows, checks, facts: run.facts, doctorNames });
    expect((await reopen(out.bytes)).getWorksheet('Sheet1')!.getRow(5).getCell('F').value).toBe(11500.25);
  });

  it('adds a formula, with a note, if a pre-made row has none', async () => {
    const t = await loadTemplate(await drrTemplate(), 'drr');
    t.sheet.getRow(5).getCell('I').value = null;
    const fill = fillTable(t, 'drr', drrRows);
    expect(t.sheet.getRow(5).getCell('I').formula).toBe('+F5+G5+H5');
    expect(fill.notes[0]).toMatch(/Row 5: the template had no formula for Total Revenue/);
  });
});

describe('Checks and Data sheets', () => {
  it('lists every check with level, numbers, details and the note, and escapes text', async () => {
    const out = await buildReport({ template: await drrTemplate(), kind: 'drr', rows: drrRows, checks, facts: run.facts, doctorNames });
    const ws = (await reopen(out.bytes)).getWorksheet('Checks')!;
    expect(ws.getRow(1).values).toEqual([undefined, 'Level', 'Check', 'Message', 'Rows', 'Amount (₹)', 'Details', 'Note']);
    expect(ws.getRow(2).getCell(1).value).toBe('Warning');
    expect(ws.getRow(2).getCell(4).value).toBe(1);
    expect(ws.getRow(2).getCell(6).value).toBe('Dr Unknown: 1 row');
    expect(ws.getRow(2).getCell(7).value).toBe('Visiting doctor');
    expect(ws.getRow(3).getCell(2).value).toBe(`'=HYPERLINK("x")`);
    expect(ws.getRow(3).getCell(3).value).toBe("'-starts with a dash");
  });

  it('has one Data row per fact, with names, amounts in rupees and no patient fields', async () => {
    const out = await buildReport({ template: await drrTemplate(), kind: 'drr', rows: drrRows, checks, facts: run.facts, doctorNames });
    const ws = (await reopen(out.bytes)).getWorksheet('Data')!;
    expect(ws.rowCount).toBe(run.facts.length + 1);
    const headers = (ws.getRow(1).values as unknown[]).slice(1);
    expect(headers).toEqual(['Month', 'Measure', 'Amount (₹)', 'Count', 'Doctor', 'Department', 'Sponsor', 'Source', 'File', 'Row', 'Reference', 'UMRNO', 'Date', 'Attribution', 'Attribution method']);
    expect(headers.join(' ')).not.toMatch(/patient|name of|phone|address/i);

    const rows = ws.getRows(2, ws.rowCount - 1)!.map((r) => r.values as unknown[]);
    const g1 = rows.find((r) => r[11] === 'G1')!;
    expect(g1[2]).toBe('IP_REVENUE');
    expect(g1[3]).toBe(9500.25);
    expect(g1[5]).toBe('A Kumar');
    expect(rows.find((r) => r[2] === 'IP_COUNT')![4]).toBe(1); // a count goes in the Count column
    expect(rows.some((r) => r[5] === '(unmatched doctor)')).toBe(true);
    expect(rows.some((r) => r[5] === 'Pharmacy – Unattributed')).toBe(true);
  });
});

describe('table fill: Sponsor-wise', () => {
  it('fills the same way, with the sponsor name and no cost columns', async () => {
    const out = await buildReport({ template: await sponsorTemplate(), kind: 'sponsor', rows: sponsorRows, checks, facts: run.facts, doctorNames });
    const ws = (await reopen(out.bytes)).getWorksheet('Sheet1')!;
    expect(ws.getRow(4).getCell('B').value).toBe('Sponsor Name');
    expect(ws.getRow(5).getCell('B').value).toBe('GENERAL');
    expect(ws.getRow(5).getCell('C').value).toEqual(new Date(Date.UTC(2026, 9, 1)));
    expect(ws.getRow(5).getCell('H').formula).toBe('+E5+F5+G5');
    expect(ws.getRow(5).getCell('L').formula).toBe('+H5-I5-K5');
    expect(num(ws.getRow(5).getCell('L').value)).toBeCloseTo(sponsorRows[0]!.values.GROSS_PROFIT / 100, 2);
  });
});

describe('self-check of the template formulas', () => {
  it('passes when the template formulas give the report\'s numbers', async () => {
    const t = await loadTemplate(await drrTemplate(), 'drr');
    expect(verifyCalcFormulas(t, 'drr', drrRows)).toEqual({ mismatches: [], unreadable: [] });
    const c = await checkTemplate(await drrTemplate(), 'drr', drrRows);
    expect(c).toMatchObject({ id: 'template-drr', level: 'Pass' });
    expect((await checkTemplate(await sponsorTemplate(), 'sponsor', sponsorRows)).level).toBe('Pass');
  });

  it('fails when a template formula was changed (Gross Profit forgets the professional fee)', async () => {
    const bytes = await drrTemplate({ formula: { 'Gross Profit': (r) => `+I${r}-J${r}-L${r}-M${r}-N${r}-O${r}` } });
    const t = await loadTemplate(bytes, 'drr');
    const v = verifyCalcFormulas(t, 'drr', drrRows);
    expect(v.mismatches).toHaveLength(1); // only Dr A has a professional fee
    expect(v.mismatches[0]).toMatchObject({ row: 5, name: 'A Kumar', column: 'Gross Profit' });

    const c = await checkTemplate(bytes, 'drr', drrRows);
    expect(c.level).toBe('Fail');
    expect(c.details?.[0]).toMatch(/Row 5, A Kumar, Gross Profit: the template gives .*, the report has /);
    await expect(buildReport({ template: bytes, kind: 'drr', rows: drrRows, checks, facts: run.facts, doctorNames })).rejects.toThrow(TemplateError);
  });

  it('fails when a formula cannot be checked because it refers to another row', async () => {
    const bytes = await drrTemplate({ formula: { 'Total Revenue': (r) => `+F${r - 1}+G${r}+H${r}` } });
    const c = await checkTemplate(bytes, 'drr', drrRows);
    expect(c.level).toBe('Fail');
    expect(c.details?.[0]).toMatch(/refers to another row/);
  });

  it('fails for a template with missing columns, and only warns when there is no template', async () => {
    expect((await checkTemplate(await drrTemplate({ omit: ['Incentives'] }), 'drr', drrRows)).message).toMatch(/no column for Incentives/);
    expect(await checkTemplate(null, 'drr', drrRows)).toMatchObject({ level: 'Warning' });
  });
});

describe('output file names', () => {
  it('follows DRR_<YYYY-MM>_run<n>.xlsx', () => {
    expect(reportFileName('drr', '2026-10', 1)).toBe('DRR_2026-10_run1.xlsx');
    expect(reportFileName('sponsor', '2026-10', 12)).toBe('Sponsorwise_2026-10_run12.xlsx');
  });
});
