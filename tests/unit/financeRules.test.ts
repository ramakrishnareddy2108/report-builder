// The business rules finance confirmed for the DRR and the Sponsor-wise report:
//   1. OP Revenue = OP Billing + OP Consultations (an OR filter), each with its own tie-out
//   2. OP pharmacy sold to admitted patients stays out (billed in the IP bill) and is shown as an info line in the Checks
//   3. unattributed pharmacy is left out of the DRR (excludeRowsWhere), listed in the Checks, and added back by the tie-out
//   4. a missing Costs file is a warning
// plus the cleanup results for doctor names, run through the real DRR recipe.

import { describe, expect, it } from 'vitest';
import { assignFiles } from '@/engine/assignFiles';
import { cleanup } from '@/engine/cleanup';
import { generate } from '@/engine/generate';
import { buildReport } from '@/engine/report';
import type { CombinedTable } from '@/engine/types';
import { openWorkbook } from '@/excel/readWorkbook';
import { starterRecipes } from '@/recipe/defaults';
import type { Recipe, ReportDef } from '@/recipe/schema';
import { inspectFileTask } from '@/worker/tasks/inspectFile';
import { asFile, hisWorkbook } from '../helpers/syntheticWorkbook';

type Cell = string | number | null;
type ExcelCell = string | number | Date | null;
type ColType = 'text' | 'money' | 'number' | 'date';
const table = (names: string[], data: Cell[][], types: Record<string, ColType> = {}): CombinedTable => ({
  columns: names.map((n) => ({ name: n, type: types[n] ?? 'text' })),
  rows: data.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i] ?? null]))),
});

// ---- report: excludeRowsWhere and the OR source filter ----------------------------------------------------------------

describe('report: leave out rows where…', () => {
  const UNATTRIBUTED = 'Pharmacy – Unattributed';
  const cols = ['Doctor', 'Source', 'Amount', 'Cost', 'UMRNO'];
  const types = { Amount: 'money', Cost: 'money' } as const;
  const data: Cell[][] = [
    ['Dr A', 'OP Pharmacy', 100000, 60000, 'U1'], //                       attributed
    [UNATTRIBUTED, 'OP Pharmacy', 50000, 30000, null], //                  counter sale
    [UNATTRIBUTED, 'OP Pharmacy', 20000, 10000, 'U9'], //                  UMRNO with no consultation
    [UNATTRIBUTED, 'OP Returns', -5000, null, null], //                    a counter return
    ['Dr A', 'OP Billing', 70000, null, 'U1'],
    ['Dr A', 'OP Consultations', 30000, null, 'U1'],
    ['Dr B', 'OP Billing', 10000, null, 'U2'],
  ];
  const def = (extra: Partial<ReportDef> = {}): ReportDef => ({
    groupBy: ['Doctor'],
    columns: [
      { kind: 'group', name: 'Doctor Name', from: 'Doctor' },
      { kind: 'aggregate', name: 'OP Revenue', agg: 'SUM', of: 'Amount', where: 'OR([Source]="OP Billing",[Source]="OP Consultations")', type: 'money' },
      { kind: 'aggregate', name: 'OP Pharmacy', agg: 'SUM', of: 'Amount', where: 'OR([Source]="OP Pharmacy",[Source]="OP Returns")', type: 'money' },
      { kind: 'aggregate', name: 'OP Pharmacy Cost', agg: 'SUM', of: 'Cost', where: '[Source]="OP Pharmacy"', type: 'money' },
    ],
    totalsRow: true,
    ...extra,
  });
  const exclude = {
    excludeRowsWhere: `[Doctor]="${UNATTRIBUTED}"`,
    excludeLabel: 'unattributed OP pharmacy',
    excludeAmountLabels: { 'OP Pharmacy': 'sales', 'OP Pharmacy Cost': 'cost' },
    excludeGroups: [
      { label: 'no UMRNO (counter sales)', where: 'ISBLANK([UMRNO])' },
      { label: 'UMRNO with no consultation this month', where: 'NOT(ISBLANK([UMRNO]))' },
    ],
  };

  it('the OR source filter adds the two sources, and only those', () => {
    const r = buildReport(table(cols, data, types), def());
    expect(r.issues).toEqual([]);
    expect(r.totals?.['OP Revenue']).toBe(70000 + 30000 + 10000);
    expect(r.rows.find((x) => x['Doctor Name'] === 'Dr A')?.['OP Revenue']).toBe(100000);
    expect(r.sourceShares['OP REVENUE']).toEqual({ 'OP BILLING': 80000, 'OP CONSULTATIONS': 30000 });
  });

  it('without the option nothing is excluded: the unattributed doctor is a report row', () => {
    const r = buildReport(table(cols, data, types), def());
    expect(r.excluded).toBeNull();
    expect(r.rows.map((x) => x['Doctor Name'])).toContain(UNATTRIBUTED);
    expect(r.totals?.['OP Pharmacy']).toBe(100000 + 50000 + 20000 - 5000);
  });

  it('rows it is TRUE for are in no report row and no total; they are counted with their amounts, split in groups', () => {
    const r = buildReport(table(cols, data, types), def(exclude));
    expect(r.issues).toEqual([]);
    expect(r.rows.map((x) => x['Doctor Name'])).toEqual(['Dr A', 'Dr B']);
    expect(r.totals?.['OP Pharmacy']).toBe(100000);
    expect(r.totals?.['OP Pharmacy Cost']).toBe(60000);
    expect(r.inputRows).toBe(7); // every combined row was looked at

    expect(r.excluded).toEqual({
      label: 'unattributed OP pharmacy',
      amountLabels: { 'OP Pharmacy': 'sales', 'OP Pharmacy Cost': 'cost' },
      rows: 3,
      amounts: { 'OP Pharmacy': 50000 + 20000 - 5000, 'OP Pharmacy Cost': 40000 },
      groups: [
        { label: 'no UMRNO (counter sales)', rows: 2, amounts: { 'OP Pharmacy': 45000, 'OP Pharmacy Cost': 30000 } },
        { label: 'UMRNO with no consultation this month', rows: 1, amounts: { 'OP Pharmacy': 20000, 'OP Pharmacy Cost': 10000 } },
      ],
    });
  });

  it('source total = report share + excluded share (the numbers the tie-out uses)', () => {
    const r = buildReport(table(cols, data, types), def(exclude));
    const pharmacy = (source: string) => Number(r.sourceShares['OP PHARMACY']?.[source] ?? 0) + Number(r.excludedShares['OP PHARMACY']?.[source] ?? 0);
    // the sources' own totals: sales 100000 + 50000 + 20000, returns -5000
    expect(pharmacy('OP PHARMACY')).toBe(170000);
    expect(pharmacy('OP RETURNS')).toBe(-5000);
    expect(r.excludedShares['OP PHARMACY']).toEqual({ 'OP PHARMACY': 70000, 'OP RETURNS': -5000 });
    expect(r.sourceShares['OP PHARMACY']).toEqual({ 'OP PHARMACY': 100000 });
  });

  it('the formula ignores case, and a row that is not matched stays in the report', () => {
    const r = buildReport(table(cols, data, types), def({ excludeRowsWhere: '[doctor]="pharmacy – UNATTRIBUTED"' }));
    expect(r.excluded?.rows).toBe(3);
    const none = buildReport(table(cols, data, types), def({ excludeRowsWhere: '[Doctor]="Nobody"' }));
    expect(none.excluded).toBeNull();
    expect(none.rows).toHaveLength(3);
  });

  it('with no groups the excluded rows are one group called "other"', () => {
    const r = buildReport(table(cols, data, types), def({ excludeRowsWhere: exclude.excludeRowsWhere }));
    expect(r.excluded?.label).toBeNull();
    expect(r.excluded?.groups.map((g) => [g.label, g.rows])).toEqual([['other', 3]]);
  });

  it('a column that does not exist, or a formula that is not valid, is an error that says so', () => {
    const unknown = buildReport(table(cols, data, types), def({ excludeRowsWhere: '[Nope]="x"' }));
    expect(unknown.issues.map((i) => i.level)).toEqual(['error']);
    expect(unknown.issues[0]?.message).toMatch(/leave out rows where.*\[Nope\]/);
    const invalid = buildReport(table(cols, data, types), def({ excludeRowsWhere: '[Doctor]=' }));
    expect(invalid.issues[0]?.message).toMatch(/not a valid formula/);
    const badGroup = buildReport(table(cols, data, types), def({ ...exclude, excludeGroups: [{ label: 'g', where: '[Nope]=1' }] }));
    expect(badGroup.issues[0]?.message).toMatch(/group “g”.*\[Nope\]/);
  });

  it('a row the formula cannot be evaluated on is kept (and the Checks warn), never dropped', () => {
    const r = buildReport(table(cols, data, types), def({ excludeRowsWhere: '[Amount]/([Cost]-[Cost])=1' }));
    expect(r.excluded).toBeNull();
    expect(r.rows).toHaveLength(3);
    expect(r.issues.map((i) => i.level)).toEqual(['warning']);
    expect(r.issues[0]?.message).toMatch(/could not be evaluated on 7 rows/);
  });
});

// ---- the starter recipes on made-up exports ------------------------------------------------------------------------------

const [drr, sponsor] = starterRecipes() as [Recipe, Recipe];
const d = (day: number) => new Date(Date.UTC(2026, 9, day));
const DOC = 'Dr. A Kumar';
const DEPT = 'Cardiology';
const SP = 'Star Health';

/** Pharmacy sold to: U1 (has a consultation), nobody (counter), U9 (no consultation), and an admitted patient (ADM1). */
const PHARMACY: ExcelCell[][] = [
  ['P1', d(5), 'U1', null, SP, 80, 50],
  ['P2', d(5), null, null, SP, 30, 20],
  ['P3', d(5), 'U9', null, SP, 40, 25],
  ['P4', d(5), 'U1', 'ADM1', SP, 70, 40],
];
const RETURNS: ExcelCell[][] = [
  ['P1', d(6), 'U1', null, SP, 10],
  ['P2', d(6), null, null, SP, 5],
  ['P4', d(6), 'U1', 'ADM1', SP, 7],
];

function exportsFor(opts: { costs?: boolean } = {}) {
  const files: [string, Uint8Array][] = [
    ['IP Discharge Report Oct2026.xlsx', hisWorkbook('Sheet1', ['ADMISSIONNO', 'DISCHARGEDT', 'DOCTORNAME', 'DEPARTMENTNAME', 'ORGANIZATIONNAME'], [['A1', d(3), DOC, DEPT, SP], [null, null, null, null, null]])],
    ['IP General Bill Breakup Oct2026.xlsx', hisWorkbook('Sheet1', ['BILLNO', 'BILLDT', 'GROSSAMOUNT', 'CONCESSION', 'DOCTORNAME', 'DEPARTMENTNAME', 'BILLSTATUS', 'ORGNAME'], [['G1', '04-OCT-2026', 1000, 100, DOC, DEPT, 'CLEARED', SP]])],
    ['IP Bill Breakups oct2026.xlsx', hisWorkbook('Sheet1', ['BILLNO', 'BILLDT', 'DOCTORNAME', 'DEPARTMENTNAME', 'ORGANIZATIONNAME', 'PHARMACY', 'PHARPURCAMOUNT'], [['G1', '04-OCT-2026', DOC, DEPT, SP, 50, 30]])],
    ['OP Billing Report Oct2026.xlsx', hisWorkbook('Sheet1', ['UMRNO', 'BILLNO', 'BILLDT', 'DOCTORNAME', 'DEPARTMENTNAME', 'ORGANIZATIONNAME', 'NETAMOUNT'], [['U1', 'B1', d(4), DOC, DEPT, SP, 200], [null, null, null, null, null, null, 200]])],
    ['OP Consultations Report Oct2026.xlsx', hisWorkbook('Sheet1', ['CONSULTATIONNO', 'CONSULTATIONDT', 'UMRNO', 'DOCTORNAME', 'DEPARTMENTNAME', 'Net Amount', 'ORGANIZATIONNAME'], [['C1', d(2), 'U1', DOC, DEPT, 100, SP], [null, null, null, null, null, 100, null]])],
    ['gst op pharmacy sales oct 2026.xlsx', hisWorkbook('OP pharmacy sales data', ['BILLNO', 'BILLDT', 'UMRNO', 'ADMNNO', 'ORGANIZATIONNAME', 'SALEVALUE_BEFORETAX', 'PURCHASEVALUE_BEFORE_TAX'], PHARMACY)],
    ['op returns report oct 2026.xlsx', hisWorkbook('Sheet1', ['ORIGINAL_BILLNO', 'BILLDT', 'UMRNO', 'ADMISSIONNO', 'ORGANIZATIONNAME', 'SALEVALUE_BEFORETAX'], RETURNS)],
  ];
  if (opts.costs) files.push(['Costs Oct2026.xlsx', hisWorkbook('Sheet1', ['Doctor', 'Departmental Issues Cost', 'Salary Cost', 'Incentives', 'Professional Fee'], [[DOC, 1, 2, 3, 4]])]);
  return files;
}

/** The recipe with a plain output (no template needed), run on the made-up exports. */
async function run(recipe: Recipe, opts: { costs?: boolean; edit?: (r: Recipe) => void } = {}) {
  const r: Recipe = structuredClone(recipe);
  r.output = { mode: 'plain', sheetName: 'Report', includeChecksSheet: false, includeCombinedSheet: false };
  opts.edit?.(r);
  const bytes = new Map<string, Uint8Array>();
  const probes = [];
  for (const [name, data] of exportsFor(opts)) {
    bytes.set(name, data);
    probes.push({ name, sheets: (await inspectFileTask({ file: asFile(data, name), headersOnly: true })).sheets });
  }
  const assigned = assignFiles(probes, r);
  const files = assigned.assignments.map((a) => ({ sourceId: a.sourceId, fileName: a.fileName, workbook: openWorkbook(bytes.get(a.fileName) as Uint8Array) }));
  return generate({ recipe: r, params: { Month: 'Oct-2026' }, files });
}
const check = (result: Awaited<ReturnType<typeof run>>, title: string) => result.checks.find((c) => c.title === title);

describe('DRR on made-up exports: the confirmed rules', () => {
  it('OP Pharmacy leaves out the unattributed lines (counter sales and unknown UMRNO); only the attributed doctor is in the report', async () => {
    const result = await run(drr);
    expect(result.checks.filter((c) => c.level === 'error')).toEqual([]);
    expect(result.report?.rows).toHaveLength(1);
    const row = result.report?.rows[0];
    expect(row?.['Doctor Name']).toBe('A Kumar');
    expect(row?.['OP Pharmacy']).toBe(7000); // sales 80 - return 10, in paise
    expect(row?.['OP Pharmacy Cost']).toBe(5000);
    expect(result.report?.totals?.['OP Pharmacy']).toBe(7000);
  });

  it('the Checks list the excluded lines: sales and cost, split into counter sales and UMRNO with no consultation', async () => {
    const result = await run(drr);
    const c = check(result, 'Excluded from report: unattributed OP pharmacy');
    expect(c?.level).toBe('info');
    // P2 sale 30 + P3 sale 40 - P2 return 5 = 65 ; cost 20 + 25 = 45 ; lines: P2, P3, P2 return
    expect(c?.message).toMatch(/^3 lines, sales ₹65\.00, cost ₹45\.00\./);
    expect(c?.rows).toBe(3);
    expect(c?.details?.map((x) => x.text)).toEqual([
      'no UMRNO (counter sales): 2 lines, sales ₹25.00, cost ₹20.00',
      'UMRNO with no consultation this month: 1 line, sales ₹40.00, cost ₹25.00',
    ]);
    // the unattributed lines are also in the lookup warning, as before
    expect(check(result, 'Lookup: OP Pharmacy attribution')?.level).toBe('warning');
  });

  it('the OP Pharmacy tie-out is: source total = report total + excluded total', async () => {
    const result = await run(drr);
    const c = check(result, 'Tie-out: OP Pharmacy total');
    expect(c?.level).toBe('info');
    // sales 80 + 30 + 40, returns -10 -5 = 135 = report 70 + excluded 65
    expect(c?.message).toBe('OP Pharmacy + OP Returns total ₹135.00 matches the report ₹70.00 + excluded ₹65.00.');
  });

  it('a mismatch of the OP Pharmacy tie-out is an Error and blocks the download', async () => {
    // Break the report on purpose: OP Pharmacy now forgets the returns, so ₹15 of the source is neither reported nor excluded.
    const result = await run(drr, {
      edit: (r) => {
        const col = r.report.columns.find((c) => c.name === 'OP Pharmacy');
        if (col?.kind === 'aggregate') col.where = '[Source]="OP Pharmacy"';
        const t = r.checks.tieOuts.find((x) => x.label === 'OP Pharmacy total');
        if (t) t.tolerance = 0.01;
      },
    });
    const c = check(result, 'Tie-out: OP Pharmacy total');
    expect(c?.level).toBe('error');
    expect(c?.message).toMatch(/total is ₹135\.00 but the report shows ₹80\.00 \+ excluded ₹70\.00: a difference of ₹15\.00/);
    expect(result.canDownload).toBe(false);
  });

  it('OP Revenue = OP Billing + OP Consultations, each checked against its own total row', async () => {
    const result = await run(drr);
    expect(result.report?.rows[0]?.['OP Revenue']).toBe(30000);
    expect(result.report?.sourceShares['OP REVENUE']).toEqual({ 'OP BILLING': 20000, 'OP CONSULTATIONS': 10000 });
    expect(check(result, 'Tie-out: OP Billing total')?.message).toBe('OP Billing total ₹200.00 matches the report ₹200.00.');
    expect(check(result, 'Tie-out: OP Consultations total')?.message).toBe('OP Consultations total ₹100.00 matches the report ₹100.00.');
  });

  it('if OP Revenue forgot the consultations, the consultations tie-out says so (and the billing one still matches)', async () => {
    const result = await run(drr, {
      edit: (r) => {
        const col = r.report.columns.find((c) => c.name === 'OP Revenue');
        if (col?.kind === 'aggregate') col.where = '[Source]="OP Billing"';
      },
    });
    expect(check(result, 'Tie-out: OP Billing total')?.level).toBe('info');
    const c = check(result, 'Tie-out: OP Consultations total');
    expect(c?.level).toBe('warning');
    expect(c?.message).toMatch(/total is ₹100\.00 but the report shows ₹0\.00/);
  });

  it('pharmacy to admitted patients stays excluded and is shown as an info line with its rows and amount', async () => {
    const result = await run(drr);
    const c = check(result, 'Pharmacy to admitted patients excluded (billed in IP bill)');
    expect(c?.level).toBe('info');
    // P4 sale 70 and P4 return -7: 2 rows, net 63
    expect(c?.message).toBe('2 rows, ₹63.00.');
    expect(c?.rows).toBe(2);
    expect(c?.amountPaise).toBe(6300);
    // and none of it is in the report
    expect(result.combined.rows.some((r) => r.Ref === 'P4')).toBe(false);
  });

  it('a missing Costs file is a warning that says Gross Profit is before these costs; with the file there is no warning', async () => {
    const without = await run(drr);
    const warning = without.checks.find((c) => /^Costs file not uploaded/.test(c.message));
    expect(warning?.level).toBe('warning');
    expect(warning?.message).toBe('Costs file not uploaded — Departmental Issues, Salary, Incentives and Professional Fee are 0, so Gross Profit is before these costs.');

    const withCosts = await run(drr, { costs: true });
    expect(withCosts.checks.some((c) => /Costs file not uploaded/.test(c.message))).toBe(false);
    const total = withCosts.report?.totals;
    expect([total?.['Departmental Issues Cost'], total?.['Salary Cost'], total?.Incentives, total?.['Professional Fee']]).toEqual([100, 200, 300, 400]);
  });
});

describe('Sponsor-wise on made-up exports: nothing is excluded', () => {
  it('the unattributed pharmacy stays under its sponsor, and the tie-out has nothing to add back', async () => {
    const result = await run(sponsor);
    expect(result.checks.filter((c) => c.level === 'error')).toEqual([]);
    expect(result.report?.excluded).toBeNull();
    expect(check(result, 'Excluded from report: unattributed OP pharmacy')).toBeUndefined();
    const row = result.report?.rows[0];
    expect(row?.['Sponsor Name']).toBe('Star Health');
    expect(row?.['OP Pharmacy']).toBe(13500); // 135: every sale and return, attributed or not
    expect(row?.['OP Pharmacy Cost']).toBe(9500); // 50 + 20 + 25
    expect(row?.['OP Revenue']).toBe(30000);
    expect(check(result, 'Tie-out: OP Pharmacy total')?.message).toBe('OP Pharmacy + OP Returns total ₹135.00 matches the report ₹135.00.');
    expect(check(result, 'Tie-out: OP Consultations total')?.level).toBe('info');
    // the admitted-patient line is the same in both reports; the Costs warning belongs to the DRR only
    expect(check(result, 'Pharmacy to admitted patients excluded (billed in IP bill)')?.message).toBe('2 rows, ₹63.00.');
    expect(result.checks.some((c) => /Costs file not uploaded/.test(c.message))).toBe(false);
  });
});

// ---- cleanup: the expected results, through the DRR recipe's own rule --------------------------------------------------------

describe('doctor names: the DRR recipe cleanup', () => {
  /** The whole cleanup step with the recipe's rules (the display case is applied after the text steps). */
  const clean = (raw: string) => {
    const t = table(['Doctor', 'Department'], [[raw, 'cardiology']]);
    cleanup(t, drr.cleanup);
    return t.rows[0]?.Doctor;
  };
  it.each([
    ['K.KRISHNA CHAND', 'K Krishna Chand'],
    ['G.AJAY KUMAR.', 'G Ajay Kumar'],
    ['Dr Srimannarayana (Review)', 'Srimannarayana'],
    [' BALA KRISHNA SANAMPUDI (REVIEW)', 'Bala Krishna Sanampudi'],
    [' BALA KRISHNA SANAMPUDI', 'Bala Krishna Sanampudi'],
  ])('%s → %s', (raw, expected) => {
    expect(clean(raw)).toBe(expected);
  });
});
