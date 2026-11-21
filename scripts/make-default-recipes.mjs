// Writes the two starter recipes (src/recipe/defaults/drr.recipe.json and sponsorwise.recipe.json) as described in
// CLAUDE.md ("Default DRR recipe", "Sponsor-wise recipe"). Run it after changing the rules here:
//
//   node scripts/make-default-recipes.mjs
//
// The Excel templates are NOT part of the recipes: templateBase64 is empty and the app asks for the template on first use.

import { mkdirSync, writeFileSync } from 'node:fs';

const money = (from, as) => ({ from, as, type: 'money' });
const text = (from, as) => ({ from, as, type: 'text' });
const date = (from, as) => ({ from, as, type: 'date' });

const people = [text('DOCTORNAME', 'Doctor'), text('DEPARTMENTNAME', 'Department')];
const base = { required: true, headerRow: 3, calculated: [] };

const sources = [
  {
    ...base,
    id: 'ipDischarge',
    label: 'IP Discharge',
    match: { namePattern: 'IP Discharge Report', requiredHeaders: ['DOCTORNAME', 'DEPARTMENTNAME', 'ORGANIZATIONNAME', 'ADMISSIONNO', 'DISCHARGEDT'] },
    sheet: { name: 'Sheet1' },
    columns: [...people, text('ORGANIZATIONNAME', 'Sponsor'), text('ADMISSIONNO', 'Ref'), date('DISCHARGEDT', 'Date')],
    rowFilter: 'NOT(ISBLANK([ADMISSIONNO]))',
    calculated: [{ as: 'IPCount', formula: '1', type: 'number' }],
    uniqueColumn: 'Ref',
  },
  {
    ...base,
    id: 'ipGeneralBill',
    label: 'IP General Bill',
    match: { namePattern: 'IP General Bill Breakup', requiredHeaders: ['DOCTORNAME', 'DEPARTMENTNAME', 'ORGNAME', 'BILLNO', 'BILLDT', 'GROSSAMOUNT', 'CONCESSION', 'BILLSTATUS'] },
    sheet: { name: 'Sheet1' },
    columns: [
      ...people,
      text('ORGNAME', 'Sponsor'),
      text('BILLNO', 'Ref'),
      date('BILLDT', 'Date'),
      money('GROSSAMOUNT', 'GrossAmount'),
      money('CONCESSION', 'Concession'),
      text('BILLSTATUS', 'BillStatus'),
    ],
    // PENDING bills are included for now (to confirm with the finance team).
    calculated: [{ as: 'Amount', formula: '[GrossAmount]-[Concession]', type: 'money' }],
    uniqueColumn: 'Ref',
  },
  {
    ...base,
    id: 'ipBillBreakups',
    label: 'IP Bill Breakups',
    match: { namePattern: 'IP Bill Breakups', requiredHeaders: ['DOCTORNAME', 'DEPARTMENTNAME', 'ORGANIZATIONNAME', 'BILLNO', 'BILLDT', 'PHARMACY', 'PHARPURCAMOUNT'] },
    sheet: { name: 'Sheet1' },
    columns: [...people, text('ORGANIZATIONNAME', 'Sponsor'), text('BILLNO', 'Ref'), date('BILLDT', 'Date'), money('PHARMACY', 'IPPharmacy'), money('PHARPURCAMOUNT', 'IPPharmacyCost')],
  },
  {
    ...base,
    id: 'opBilling',
    label: 'OP Billing',
    match: { namePattern: 'OP Billing Report', requiredHeaders: ['DOCTORNAME', 'DEPARTMENTNAME', 'ORGANIZATIONNAME', 'UMRNO', 'BILLNO', 'BILLDT', 'NETAMOUNT'] },
    sheet: { name: 'Sheet1' },
    columns: [...people, text('ORGANIZATIONNAME', 'Sponsor'), text('UMRNO', 'UMRNO'), text('BILLNO', 'Ref'), date('BILLDT', 'Date'), money('NETAMOUNT', 'Amount')],
    rowFilter: 'NOT(ISBLANK([BILLNO]))',
    uniqueColumn: 'Ref',
  },
  {
    ...base,
    id: 'opConsultations',
    label: 'OP Consultations',
    // Used for the doctor lookup. Not in OP Revenue until the finance team confirms.
    match: { namePattern: 'OP Consultations Report', requiredHeaders: ['DOCTORNAME', 'DEPARTMENTNAME', 'ORGANIZATIONNAME', 'UMRNO', 'CONSULTATIONNO', 'CONSULTATIONDT', 'Net Amount'] },
    sheet: { name: 'Sheet1' },
    columns: [...people, text('ORGANIZATIONNAME', 'Sponsor'), text('UMRNO', 'UMRNO'), text('CONSULTATIONNO', 'Ref'), date('CONSULTATIONDT', 'Date'), money('Net Amount', 'Amount')],
    rowFilter: 'NOT(ISBLANK([CONSULTATIONNO]))',
    uniqueColumn: 'Ref',
  },
  {
    ...base,
    id: 'opPharmacy',
    label: 'OP Pharmacy',
    // One row per item sold: the bill number repeats on purpose, so there is no repeated-number check.
    match: { namePattern: 'gst op pharmacy sales', requiredHeaders: ['UMRNO', 'ADMNNO', 'ORGANIZATIONNAME', 'BILLNO', 'BILLDT', 'SALEVALUE_BEFORETAX', 'PURCHASEVALUE_BEFORE_TAX'] },
    sheet: { name: 'OP pharmacy sales data' },
    columns: [
      text('UMRNO', 'UMRNO'),
      text('ADMNNO', 'AdmissionNo'),
      text('ORGANIZATIONNAME', 'Sponsor'),
      text('BILLNO', 'Ref'),
      date('BILLDT', 'Date'),
      money('SALEVALUE_BEFORETAX', 'Amount'),
      money('PURCHASEVALUE_BEFORE_TAX', 'Cost'),
    ],
    rowFilter: 'ISBLANK([ADMNNO])',
  },
  {
    ...base,
    id: 'opReturns',
    label: 'OP Returns',
    // The sheet is "Sheet1": not "returns op" and not "Sheet4". One row per item returned, so no repeated-number check.
    match: { namePattern: 'op returns report', requiredHeaders: ['UMRNO', 'ADMISSIONNO', 'ORGANIZATIONNAME', 'ORIGINAL_BILLNO', 'BILLDT', 'SALEVALUE_BEFORETAX'] },
    sheet: { name: 'Sheet1' },
    columns: [
      text('UMRNO', 'UMRNO'),
      text('ADMISSIONNO', 'AdmissionNo'),
      text('ORGANIZATIONNAME', 'Sponsor'),
      text('ORIGINAL_BILLNO', 'Ref'),
      date('BILLDT', 'Date'),
      money('SALEVALUE_BEFORETAX', 'ReturnValue'),
    ],
    rowFilter: 'ISBLANK([ADMISSIONNO])',
    calculated: [{ as: 'Amount', formula: '-[SALEVALUE_BEFORETAX]', type: 'money' }],
  },
  {
    ...base,
    id: 'costs',
    label: 'Costs',
    required: false,
    match: { namePattern: 'Costs', requiredHeaders: ['Doctor', 'Departmental Issues Cost', 'Salary Cost', 'Incentives', 'Professional Fee'] },
    sheet: {},
    headerRow: 'auto',
    columns: [text('Doctor', 'Doctor'), money('Departmental Issues Cost', 'Departmental Issues Cost'), money('Salary Cost', 'Salary Cost'), money('Incentives', 'Incentives'), money('Professional Fee', 'Professional Fee')],
  },
];

const lookup = (id, label) => ({
  label,
  target: { source: id, column: 'Doctor', key: 'UMRNO', date: 'Date' },
  from: { source: 'opConsultations', key: 'UMRNO', value: 'Doctor', date: 'Date', extraValues: [{ from: 'Department', as: 'Department' }] },
  onlyWhen: 'ISBLANK([AdmissionNo])',
  pick: 'latestOnOrBefore',
  notFoundValue: 'Pharmacy – Unattributed',
  writeStatusColumn: 'Attribution',
});

const rule = (column, over) => ({ column, normalize: { trim: true, collapseSpaces: true, ignoreCase: true, removeChars: '', ...over }, displayCase: 'asIs', aliases: [] });

const where = (...labels) => (labels.length === 1 ? `[Source]="${labels[0]}"` : `OR(${labels.map((l) => `[Source]="${l}"`).join(',')})`);
const sum = (name, of, wh, type = 'money') => ({ kind: 'aggregate', name, agg: 'SUM', of, ...(wh ? { where: wh } : {}), type });

const drrColumns = [
  { kind: 'serial', name: 'S.No.' },
  { kind: 'group', name: 'Doctor Name', from: 'Doctor' },
  { kind: 'group', name: 'Department', from: 'Department' },
  { kind: 'group', name: 'Month', from: 'Month' },
  sum('IP Count', 'IPCount', where('IP Discharge'), 'number'),
  sum('IP Revenue', 'Amount', where('IP General Bill')),
  // OP Consultations are left out of OP Revenue until the finance team confirms.
  sum('OP Revenue', 'Amount', where('OP Billing')),
  sum('OP Pharmacy', 'Amount', where('OP Pharmacy', 'OP Returns')),
  { kind: 'formula', name: 'Total Revenue', formula: '[IP Revenue]+[OP Revenue]+[OP Pharmacy]', type: 'money' },
  sum('OP Pharmacy Cost', 'Cost', where('OP Pharmacy')),
  sum('IP Pharmacy revenue Net', 'IPPharmacy'),
  sum('Ip Pharmacy Cost', 'IPPharmacyCost'),
  sum('Departmental Issues Cost', 'Departmental Issues Cost'),
  sum('Salary Cost', 'Salary Cost'),
  sum('Incentives', 'Incentives'),
  sum('Professional Fee', 'Professional Fee'),
  {
    kind: 'formula',
    name: 'Gross Profit',
    formula: '[Total Revenue]-[OP Pharmacy Cost]-[Ip Pharmacy Cost]-[Departmental Issues Cost]-[Salary Cost]-[Incentives]-[Professional Fee]',
    type: 'money',
  },
];

const parameters = [{ name: 'Month', type: 'text', label: 'Report month (e.g. Oct-2026)' }];
const tieOuts = [{ label: 'OP Billing total', source: 'opBilling', column: 'Amount', reportColumn: 'OP Revenue', tolerance: 1 }];

const template = (templateName) => ({
  mode: 'template',
  templateName,
  templateBase64: '',
  headerRow: 4,
  keepTemplateFormulas: true,
  includeChecksSheet: true,
  includeCombinedSheet: false,
});

const drr = {
  schemaVersion: 1,
  id: 'starter-drr',
  name: 'DRR (Doctor-wise Revenue Report)',
  description: 'Doctor-wise revenue and gross profit for a month, from the hospital exports.',
  updatedAt: '2026-11-21T00:00:00.000Z',
  parameters,
  sources,
  cleanup: [rule('Doctor', { removeChars: '.' }), rule('Department', { removeChars: '.' })].map((r) => ({ ...r, displayCase: 'title' })),
  lookups: [lookup('opPharmacy', 'OP Pharmacy attribution'), lookup('opReturns', 'OP Returns attribution')],
  report: { groupBy: ['Doctor', 'Department', 'Month'], columns: drrColumns, totalsRow: true },
  output: template('DRR Format.xlsx'),
  checks: { tieOuts },
};

const sponsorColumns = [
  { kind: 'serial', name: 'S.No.' },
  { kind: 'group', name: 'Sponsor Name', from: 'Sponsor' },
  { kind: 'group', name: 'Month', from: 'Month' },
  sum('IP Count', 'IPCount', where('IP Discharge'), 'number'),
  sum('IP Revenue', 'Amount', where('IP General Bill')),
  sum('OP Revenue', 'Amount', where('OP Billing')),
  sum('OP Pharmacy', 'Amount', where('OP Pharmacy', 'OP Returns')),
  { kind: 'formula', name: 'Total Revenue', formula: '[IP Revenue]+[OP Revenue]+[OP Pharmacy]', type: 'money' },
  sum('OP Pharmacy Cost', 'Cost', where('OP Pharmacy')),
  sum('IP Pharmacy revenue Net', 'IPPharmacy'),
  sum('Ip Pharmacy Cost', 'IPPharmacyCost'),
  { kind: 'formula', name: 'Gross Profit', formula: '[Total Revenue]-[OP Pharmacy Cost]-[Ip Pharmacy Cost]', type: 'money' },
];

const sponsor = {
  ...drr,
  id: 'starter-sponsor-wise',
  name: 'Sponsor-wise Revenue Report',
  description: 'Revenue and gross profit by sponsor (insurance / corporate / cash) for a month.',
  cleanup: [rule('Sponsor', {})],
  report: { groupBy: ['Sponsor', 'Month'], columns: sponsorColumns, totalsRow: true },
  output: template('Sponsor-wise Revenue Report.xlsx'),
};

mkdirSync('src/recipe/defaults', { recursive: true });
writeFileSync('src/recipe/defaults/drr.recipe.json', JSON.stringify(drr, null, 2) + '\n');
writeFileSync('src/recipe/defaults/sponsorwise.recipe.json', JSON.stringify(sponsor, null, 2) + '\n');
console.log('Wrote src/recipe/defaults/drr.recipe.json and sponsorwise.recipe.json');
