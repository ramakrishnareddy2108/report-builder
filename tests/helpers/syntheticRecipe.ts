// A made-up month for the engine tests: 2 doctors in different spellings, a patient with 2 consultations,
// pharmacy rows with and without a match, a return, in-patient rows that are filtered out, a footer row and
// an unreadable amount. No real data.

import type { Recipe, SourceDef } from '@/recipe/schema';
import { blankRecipe } from '@/recipe/blank';
import { hisWorkbook } from './syntheticWorkbook';

const d = (day: number) => new Date(Date.UTC(2026, 9, day, 0, 0)); // Excel dates: midnight, 2026-10-<day>

const base = { required: true, headerRow: 3 as const, calculated: [] as SourceDef['calculated'] };
const idCols = [
  { from: 'DOCTORNAME', as: 'Doctor', type: 'text' as const },
  { from: 'DEPARTMENTNAME', as: 'Department', type: 'text' as const },
  { from: 'UMRNO', as: 'UMRNO', type: 'text' as const },
];

export const opBilling: SourceDef = {
  ...base,
  id: 'opBilling',
  label: 'OP Billing',
  match: { namePattern: 'OP Billing Report', requiredHeaders: ['BILLNO', 'NETAMOUNT'] },
  sheet: { name: 'Sheet1' },
  columns: [...idCols, { from: 'BILLNO', as: 'Ref', type: 'text' }, { from: 'BILLDT', as: 'Date', type: 'date' }, { from: 'NETAMOUNT', as: 'Amount', type: 'money' }],
  rowFilter: 'NOT(ISBLANK([BILLNO]))',
  uniqueColumn: 'Ref',
};
export const opConsultations: SourceDef = {
  ...base,
  id: 'opConsultations',
  label: 'OP Consultations',
  match: { namePattern: 'OP Consultations Report', requiredHeaders: ['CONSULTATIONNO'] },
  sheet: { name: 'Sheet1' },
  columns: [...idCols, { from: 'CONSULTATIONNO', as: 'Ref', type: 'text' }, { from: 'CONSULTATIONDT', as: 'Date', type: 'date' }],
  rowFilter: 'NOT(ISBLANK([CONSULTATIONNO]))',
};
export const opPharmacy: SourceDef = {
  ...base,
  id: 'opPharmacy',
  label: 'OP Pharmacy',
  match: { namePattern: 'gst op pharmacy sales', requiredHeaders: ['SALEVALUE_BEFORETAX', 'ADMNNO'] },
  sheet: { name: 'OP pharmacy sales data' },
  columns: [
    { from: 'UMRNO', as: 'UMRNO', type: 'text' },
    { from: 'ADMNNO', as: 'AdmissionNo', type: 'text' },
    { from: 'BILLNO', as: 'Ref', type: 'text' },
    { from: 'BILLDT', as: 'Date', type: 'date' },
    { from: 'SALEVALUE_BEFORETAX', as: 'Amount', type: 'money' },
    { from: 'PURCHASEVALUE_BEFORE_TAX', as: 'Cost', type: 'money' },
  ],
  rowFilter: 'ISBLANK([ADMNNO])',
};
export const opReturns: SourceDef = {
  ...base,
  id: 'opReturns',
  label: 'OP Returns',
  match: { namePattern: 'op returns report', requiredHeaders: ['ORIGINAL_BILLNO'] },
  sheet: { name: 'Sheet1' },
  columns: [
    { from: 'UMRNO', as: 'UMRNO', type: 'text' },
    { from: 'ADMISSIONNO', as: 'AdmissionNo', type: 'text' },
    { from: 'ORIGINAL_BILLNO', as: 'Ref', type: 'text' },
    { from: 'BILLDT', as: 'Date', type: 'date' },
    { from: 'SALEVALUE_BEFORETAX', as: 'ReturnValue', type: 'money' },
  ],
  rowFilter: 'ISBLANK([ADMISSIONNO])',
  calculated: [{ as: 'Amount', formula: '-[ReturnValue]', type: 'money' }],
};
export const costs: SourceDef = {
  ...base,
  id: 'costs',
  label: 'Costs',
  required: false,
  match: { namePattern: 'Costs', requiredHeaders: ['Salary Cost'] },
  sheet: {},
  headerRow: 'auto',
  columns: [
    { from: 'Doctor', as: 'Doctor', type: 'text' },
    { from: 'Department', as: 'Department', type: 'text' },
    { from: 'Salary Cost', as: 'Salary', type: 'money' },
  ],
};

export const SOURCES = [opBilling, opConsultations, opPharmacy, opReturns, costs];

export function files(opts: { withCosts?: boolean } = {}): { sourceId: string; fileName: string; bytes: Uint8Array }[] {
  const billing = hisWorkbook(
    'Sheet1',
    ['BILLNO', 'BILLDT', 'UMRNO', 'DOCTORNAME', 'DEPARTMENTNAME', 'NETAMOUNT'],
    [
      ['B1', d(2), 'UMR1', 'Dr. A Kumar', 'Cardiology', 1000.1],
      ['B2', '03-OCT-2026', 'UMR2', ' dr a  kumar ', 'CARDIOLOGY', 500.05],
      ['B3', d(4), 'UMR3', 'Dr B Rao', 'Neurology', 2000],
      ['B4', d(20), 'UMR4', 'Dr B Rao', 'Neurology', 'oops'], // unreadable amount
      [null, null, null, null, null, 3500.15], // footer
    ],
  );
  const consultations = hisWorkbook(
    'Sheet1',
    ['CONSULTATIONNO', 'CONSULTATIONDT', 'UMRNO', 'DOCTORNAME', 'DEPARTMENTNAME'],
    [
      ['C1', d(2), 'UMR1', 'Dr. A Kumar', 'Cardiology'],
      ['C2', d(10), 'UMR1', 'Dr B Rao', 'Neurology'],
      ['C3', d(4), 'UMR3', 'Dr B Rao', 'Neurology'],
    ],
  );
  const pharmacy = hisWorkbook(
    'OP pharmacy sales data',
    ['BILLNO', 'BILLDT', 'UMRNO', 'ADMNNO', 'SALEVALUE_BEFORETAX', 'PURCHASEVALUE_BEFORE_TAX'],
    [
      ['P1', d(5), 'UMR1', null, 100.1, 60.05],
      ['P1', d(1), 'UMR1', null, 50, 20], // before any consultation: nearest later one
      ['P3', d(6), 'UMR9', null, 70.2, 30.1], // no consultation at all
      ['P4', d(7), 'UMR3', 'ADM1', 999, 500], // in-patient line: filtered out
      ['P5', d(12), 'UMR3', null, 200, 90],
    ],
  );
  const returns = hisWorkbook(
    'Sheet1',
    ['ORIGINAL_BILLNO', 'BILLDT', 'UMRNO', 'ADMISSIONNO', 'SALEVALUE_BEFORETAX'],
    [
      ['P1', d(12), 'UMR1', null, 10.1],
      ['P5', d(12), 'UMR3', 'ADM2', 5], // in-patient return: filtered out
    ],
  );
  const out = [
    { sourceId: 'opBilling', fileName: 'OP Billing Report Oct2026.xlsx', bytes: billing },
    { sourceId: 'opConsultations', fileName: 'OP Consultations Report Oct2026.xlsx', bytes: consultations },
    { sourceId: 'opPharmacy', fileName: 'gst op pharmacy sales oct 2026.xlsx', bytes: pharmacy },
    { sourceId: 'opReturns', fileName: 'op returns report oct 2026.xlsx', bytes: returns },
  ];
  if (opts.withCosts !== false) {
    out.push({
      sourceId: 'costs',
      fileName: 'Costs.xlsx',
      bytes: hisWorkbook('Costs', ['Doctor', 'Department', 'Salary Cost'], [['DR. A KUMAR', 'cardiology', 5000], ['Dr B  Rao', 'Neurology', 4000]]),
    });
  }
  return out;
}

export function recipe(overrides: Partial<Recipe> = {}): Recipe {
  const r = blankRecipe('Synthetic DRR');
  r.sources = SOURCES;
  r.cleanup = [
    { column: 'Doctor', normalize: { trim: true, collapseSpaces: true, ignoreCase: true, removeChars: '.' }, displayCase: 'title', aliases: [] },
    { column: 'Department', normalize: { trim: true, collapseSpaces: true, ignoreCase: true, removeChars: '.' }, displayCase: 'title', aliases: [] },
  ];
  const lookup = (source: 'opPharmacy' | 'opReturns') => ({
    label: `${source === 'opPharmacy' ? 'Pharmacy' : 'Returns'} attribution`,
    target: { source, column: 'Doctor', key: 'UMRNO', date: 'Date' },
    from: { source: 'opConsultations', key: 'UMRNO', value: 'Doctor', date: 'Date', extraValues: [{ from: 'Department', as: 'Department' }] },
    onlyWhen: 'ISBLANK([AdmissionNo])',
    pick: 'latestOnOrBefore' as const,
    notFoundValue: 'Pharmacy – Unattributed',
    writeStatusColumn: 'Attribution',
  });
  r.lookups = [lookup('opPharmacy'), lookup('opReturns')];
  const pharmacyOnly = 'OR([Source]="OP Pharmacy",[Source]="OP Returns")';
  r.report = {
    groupBy: ['Doctor', 'Department', 'Month'],
    columns: [
      { kind: 'serial', name: 'S.No.' },
      { kind: 'group', name: 'Doctor Name', from: 'Doctor' },
      { kind: 'group', name: 'Department', from: 'Department' },
      { kind: 'group', name: 'Month', from: 'Month' },
      { kind: 'aggregate', name: 'OP Revenue', agg: 'SUM', of: 'Amount', where: '[Source]="OP Billing"', type: 'money' },
      { kind: 'aggregate', name: 'OP Pharmacy', agg: 'SUM', of: 'Amount', where: pharmacyOnly, type: 'money' },
      { kind: 'formula', name: 'Total Revenue', formula: '[OP Revenue]+[OP Pharmacy]', type: 'money' },
      { kind: 'aggregate', name: 'OP Pharmacy Cost', agg: 'SUM', of: 'Cost', where: '[Source]="OP Pharmacy"', type: 'money' },
      { kind: 'aggregate', name: 'Salary Cost', agg: 'SUM', of: 'Salary', type: 'money' },
      { kind: 'formula', name: 'Gross Profit', formula: '[Total Revenue]-[OP Pharmacy Cost]-[Salary Cost]', type: 'money' },
    ],
    totalsRow: true,
  };
  r.checks = { tieOuts: [{ label: 'OP Billing total', source: 'opBilling', column: 'Amount', reportColumn: 'OP Revenue', tolerance: 0.01 }] };
  return { ...r, ...overrides };
}

export const PARAMS = { Month: 'Oct-2026' };
