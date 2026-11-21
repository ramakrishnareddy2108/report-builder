import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { assignFiles } from '@/engine/assignFiles';
import { generate } from '@/engine/generate';
import { openWorkbook } from '@/excel/readWorkbook';
import { bytesToBase64 } from '@/lib/base64';
import { STARTER_IDS, starterRecipes } from '@/recipe/defaults';
import { checkRecipe } from '@/recipe/validate';
import { inspectFileTask } from '@/worker/tasks/inspectFile';
import { asFile, hisWorkbook } from '../helpers/syntheticWorkbook';

const [drr, sponsor] = starterRecipes() as [ReturnType<typeof starterRecipes>[number], ReturnType<typeof starterRecipes>[number]];

const DRR_HEADERS = ['S.No.', 'Doctor Name', 'Department', 'Month', 'IP Count', 'IP Revenue', 'OP Revenue', 'OP Pharmacy', 'Total Revenue', 'OP Pharmacy Cost', 'IP Pharmacy revenue Net', 'Ip Pharmacy Cost', 'Departmental Issues Cost', 'Salary Cost', 'Incentives', 'Professional Fee', 'Gross Profit'];
const SPONSOR_HEADERS = ['S.No.', 'Sponsor Name', 'Month', 'IP Count', 'IP Revenue', 'OP Revenue', 'OP Pharmacy', 'Total Revenue', 'OP Pharmacy Cost', 'IP Pharmacy revenue Net', 'Ip Pharmacy Cost', 'Gross Profit'];

describe('starter recipes', () => {
  it('are valid, have fixed ids, and ship without a template', () => {
    expect(STARTER_IDS).toEqual(['starter-drr', 'starter-sponsor-wise']);
    expect(drr.id).toBe('starter-drr');
    expect(sponsor.id).toBe('starter-sponsor-wise');
    for (const r of [drr, sponsor]) {
      expect(r.output).toMatchObject({ mode: 'template', templateBase64: '', headerRow: 4, keepTemplateFormulas: true });
      expect(r.parameters).toEqual([{ name: 'Month', type: 'text', label: 'Report month (e.g. Oct-2026)' }]);
    }
    expect(drr.output).toMatchObject({ templateName: 'DRR Format.xlsx' });
    expect(sponsor.output).toMatchObject({ templateName: 'Sponsor-wise Revenue Report.xlsx' });
  });

  it('give fresh copies every time (editing one never changes the next)', () => {
    const a = starterRecipes()[0]!;
    a.name = 'Changed';
    expect(starterRecipes()[0]?.name).toBe('DRR (Doctor-wise Revenue Report)');
  });

  it('the only thing missing is the template (which the app asks for on first use)', () => {
    for (const r of [drr, sponsor]) {
      const errors = checkRecipe(r).filter((p) => p.level === 'error');
      expect(errors.map((e) => e.message)).toEqual(['No template has been added. Upload the Excel template in 4 Output, or choose a plain sheet.']);
      const withTemplate = { ...r, output: { ...(r.output as Extract<typeof r.output, { mode: 'template' }>), templateBase64: 'AAAA' } };
      expect(checkRecipe(withTemplate)).toEqual([]);
    }
  });

  it('report columns match the template headings of CLAUDE.md, in order', () => {
    expect(drr.report.columns.map((c) => c.name)).toEqual(DRR_HEADERS);
    expect(sponsor.report.columns.map((c) => c.name)).toEqual(SPONSOR_HEADERS);
    expect(drr.report.groupBy).toEqual(['Doctor', 'Department', 'Month']);
    expect(sponsor.report.groupBy).toEqual(['Sponsor', 'Month']);
  });

  it('follow the rules of CLAUDE.md: sheets, filters, line-item files, cleanup, lookups', () => {
    const src = (id: string) => drr.sources.find((s) => s.id === id)!;
    expect(drr.sources.map((s) => s.id)).toEqual(['ipDischarge', 'ipGeneralBill', 'ipBillBreakups', 'opBilling', 'opConsultations', 'opPharmacy', 'opReturns', 'costs']);
    expect(src('opPharmacy').sheet).toEqual({ name: 'OP pharmacy sales data' });
    expect(src('opReturns').sheet).toEqual({ name: 'Sheet1' });
    expect(src('opReturns').calculated).toEqual([{ as: 'Amount', formula: '-[SALEVALUE_BEFORETAX]', type: 'money' }]);
    expect(src('ipGeneralBill').columns.find((c) => c.from === 'ORGNAME')?.as).toBe('Sponsor');
    expect(src('ipDischarge').calculated).toEqual([{ as: 'IPCount', formula: '1', type: 'number' }]);
    expect(src('costs').required).toBe(false);
    // the line-item files repeat the bill number on purpose, so they have no repeated-number check
    expect(src('opPharmacy').uniqueColumn).toBeUndefined();
    expect(src('opReturns').uniqueColumn).toBeUndefined();
    expect(src('opBilling').rowFilter).toBe('NOT(ISBLANK([BILLNO]))');
    expect(src('opPharmacy').rowFilter).toBe('ISBLANK([ADMNNO])');
    expect(drr.cleanup.map((c) => [c.column, c.normalize.removeChars, c.displayCase])).toEqual([['Doctor', '.', 'title'], ['Department', '.', 'title']]);
    expect(drr.lookups.map((l) => [l.target.source, l.pick, l.notFoundValue, l.writeStatusColumn])).toEqual([
      ['opPharmacy', 'latestOnOrBefore', 'Pharmacy – Unattributed', 'Attribution'],
      ['opReturns', 'latestOnOrBefore', 'Pharmacy – Unattributed', 'Attribution'],
    ]);
    expect(sponsor.cleanup).toEqual([{ column: 'Sponsor', normalize: { trim: true, collapseSpaces: true, ignoreCase: true, removeChars: '' }, displayCase: 'asIs', aliases: [] }]);
  });
});

// ---- the starter recipes on made-up files shaped like the real exports ------------------------

const d = (day: number) => new Date(Date.UTC(2026, 9, day));
const D = 'Dr. A Kumar';
const DEPT = 'Cardiology';
const SP = 'Star Health';

function exportsFor() {
  return [
    ['IP Discharge Report Oct2026.xlsx', hisWorkbook('Sheet1', ['ADMISSIONNO', 'DISCHARGEDT', 'DOCTORNAME', 'DEPARTMENTNAME', 'ORGANIZATIONNAME'], [['A1', d(3), D, DEPT, SP], [null, null, null, null, null]])],
    ['IP General Bill Breakup Oct2026.xlsx', hisWorkbook('Sheet1', ['BILLNO', 'BILLDT', 'GROSSAMOUNT', 'CONCESSION', 'DOCTORNAME', 'DEPARTMENTNAME', 'BILLSTATUS', 'ORGNAME'], [['G1', '04-OCT-2026', 1000, 100, D, DEPT, 'CLEARED', SP]])],
    ['IP Bill Breakups oct2026.xlsx', hisWorkbook('Sheet1', ['BILLNO', 'BILLDT', 'DOCTORNAME', 'DEPARTMENTNAME', 'ORGANIZATIONNAME', 'PHARMACY', 'PHARPURCAMOUNT'], [['G1', '04-OCT-2026', D, DEPT, SP, 50, 30]])],
    ['OP Billing Report Oct2026.xlsx', hisWorkbook('Sheet1', ['UMRNO', 'BILLNO', 'BILLDT', 'DOCTORNAME', 'DEPARTMENTNAME', 'ORGANIZATIONNAME', 'NETAMOUNT'], [['U1', 'B1', d(4), D, DEPT, SP, 200], [null, null, null, null, null, null, 200]])],
    ['OP Consultations Report Oct2026.xlsx', hisWorkbook('Sheet1', ['CONSULTATIONNO', 'CONSULTATIONDT', 'UMRNO', 'DOCTORNAME', 'DEPARTMENTNAME', 'Net Amount', 'ORGANIZATIONNAME'], [['C1', d(2), 'U1', D, DEPT, 100, SP]])],
    ['gst op pharmacy sales oct 2026.xlsx', hisWorkbook('OP pharmacy sales data', ['BILLNO', 'BILLDT', 'UMRNO', 'ADMNNO', 'ORGANIZATIONNAME', 'SALEVALUE_BEFORETAX', 'PURCHASEVALUE_BEFORE_TAX'], [['P1', d(5), 'U1', null, SP, 80, 50]])],
    ['op returns report oct 2026.xlsx', hisWorkbook('Sheet1', ['ORIGINAL_BILLNO', 'BILLDT', 'UMRNO', 'ADMISSIONNO', 'ORGANIZATIONNAME', 'SALEVALUE_BEFORETAX'], [['P1', d(6), 'U1', null, SP, 10]])],
  ] as const;
}

async function templateFor(headers: string[], formulas: Record<string, (r: number) => string>): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A2').value = 'Totals';
  headers.forEach((h, i) => (ws.getRow(4).getCell(i + 1).value = h));
  for (let r = 5; r <= 12; r++) {
    ws.getRow(r).getCell(1).value = r - 4;
    for (const [h, f] of Object.entries(formulas)) ws.getRow(r).getCell(headers.indexOf(h) + 1).value = { formula: f(r), result: 0 };
  }
  return bytesToBase64(new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer));
}

async function run(recipe: typeof drr, templateBase64: string) {
  const probes = [];
  const bytes = new Map<string, Uint8Array>();
  for (const [name, data] of exportsFor()) {
    bytes.set(name, data);
    const r = await inspectFileTask({ file: asFile(data, name), headersOnly: true });
    probes.push({ name, sheets: r.sheets });
  }
  const assigned = assignFiles(probes, recipe);
  const files = assigned.assignments.map((a) => ({ sourceId: a.sourceId, fileName: a.fileName, workbook: openWorkbook(bytes.get(a.fileName) as Uint8Array) }));
  const withTemplate = { ...recipe, output: { ...(recipe.output as Extract<typeof recipe.output, { mode: 'template' }>), templateBase64 } };
  return { assigned, result: await generate({ recipe: withTemplate, params: { Month: 'Oct-2026' }, files }) };
}

describe('starter recipes on made-up exports', () => {
  it('DRR: every file finds its source, and the numbers are exact', async () => {
    const template = await templateFor(DRR_HEADERS, {
      'Total Revenue': (r) => `F${r}+G${r}+H${r}`,
      'Gross Profit': (r) => `I${r}-J${r}-L${r}-M${r}-N${r}-O${r}-P${r}`,
    });
    const { assigned, result } = await run(drr, template);
    expect(assigned.assignments.map((a) => a.sourceId)).toEqual(['ipDischarge', 'ipGeneralBill', 'ipBillBreakups', 'opBilling', 'opConsultations', 'opPharmacy', 'opReturns']);
    expect(assigned.missingRequiredSources).toEqual([]);
    expect(assigned.ambiguous).toEqual([]);

    expect(result.checks.filter((c) => c.level === 'error')).toEqual([]);
    expect(result.report?.rows).toEqual([
      {
        'S.No.': 1, 'Doctor Name': 'Dr A Kumar', Department: 'Cardiology', Month: 'Oct-2026',
        'IP Count': 1, 'IP Revenue': 90000, 'OP Revenue': 20000, 'OP Pharmacy': 7000, 'Total Revenue': 117000,
        'OP Pharmacy Cost': 5000, 'IP Pharmacy revenue Net': 5000, 'Ip Pharmacy Cost': 3000,
        'Departmental Issues Cost': 0, 'Salary Cost': 0, Incentives: 0, 'Professional Fee': 0, 'Gross Profit': 109000,
      },
    ]);
    // the OP Billing footer total (200) matches OP Revenue, and the real DRR template formulas agree with the recipe
    expect(result.checks.find((c) => c.title === 'Tie-out: OP Billing total')?.level).toBe('info');
    expect(result.checks.filter((c) => c.title === 'Template')).toEqual([]);
    expect(result.canDownload).toBe(true);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.workbookBytes as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Sheet1')!;
    expect(ws.getRow(5).getCell(2).value).toBe('Dr A Kumar');
    expect(ws.getRow(5).getCell(9).value).toMatchObject({ formula: 'F5+G5+H5', result: 1170 });
    expect(ws.getRow(5).getCell(17).value).toMatchObject({ formula: 'I5-J5-L5-M5-N5-O5-P5', result: 1090 });
  });

  it('Sponsor-wise: one row per sponsor and month', async () => {
    const template = await templateFor(SPONSOR_HEADERS, {
      'Total Revenue': (r) => `E${r}+F${r}+G${r}`,
      'Gross Profit': (r) => `H${r}-I${r}-K${r}`,
    });
    const { result } = await run(sponsor, template);
    expect(result.checks.filter((c) => c.level === 'error')).toEqual([]);
    expect(result.report?.rows).toEqual([
      {
        'S.No.': 1, 'Sponsor Name': 'Star Health', Month: 'Oct-2026', 'IP Count': 1, 'IP Revenue': 90000, 'OP Revenue': 20000, 'OP Pharmacy': 7000,
        'Total Revenue': 117000, 'OP Pharmacy Cost': 5000, 'IP Pharmacy revenue Net': 5000, 'Ip Pharmacy Cost': 3000, 'Gross Profit': 109000,
      },
    ]);
    expect(result.checks.filter((c) => c.title === 'Template')).toEqual([]);
  });
});
