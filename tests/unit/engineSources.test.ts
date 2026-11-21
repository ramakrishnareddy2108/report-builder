import { describe, expect, it } from 'vitest';
import { assignFiles, normaliseFileName, type FileProbe } from '@/engine/assignFiles';
import { combine } from '@/engine/combine';
import { readSource } from '@/engine/readSource';
import { paramValues } from '@/engine/rowContext';
import { openWorkbook } from '@/excel/readWorkbook';
import { blankRecipe } from '@/recipe/blank';
import type { Recipe, SourceDef } from '@/recipe/schema';
import { combineTask } from '@/worker/tasks/combine';
import { asFile, hisWorkbook } from '../helpers/syntheticWorkbook';

// ---- three made-up sources with different columns --------------------------------------------

const opBilling: SourceDef = {
  id: 'opBilling',
  label: 'OP Billing',
  required: true,
  match: { namePattern: 'OP Billing Report', requiredHeaders: ['BILLNO', 'NETAMOUNT'] },
  sheet: { name: 'Sheet1' },
  headerRow: 3,
  columns: [
    { from: 'DOCTORNAME', as: 'Doctor', type: 'text' },
    { from: 'BILLNO', as: 'Ref', type: 'text' },
    { from: 'BILLDT', as: 'Date', type: 'date' },
    { from: 'NETAMOUNT', as: 'Amount', type: 'money' },
  ],
  rowFilter: 'NOT(ISBLANK([BILLNO]))',
  calculated: [],
  uniqueColumn: 'Ref',
};

const ipGeneral: SourceDef = {
  id: 'ipGeneral',
  label: 'IP General Bill',
  required: true,
  match: { namePattern: 'IP General Bill', requiredHeaders: ['BILLNO', 'GROSSAMOUNT', 'CONCESSION'] },
  sheet: { name: 'Sheet1' },
  headerRow: 3,
  columns: [
    { from: 'DOCTORNAME', as: 'Doctor', type: 'text' },
    { from: 'BILLNO', as: 'Ref', type: 'text' },
    { from: 'BILLDT', as: 'Date', type: 'date' },
    { from: 'GROSSAMOUNT', as: 'Gross', type: 'money' },
    { from: 'CONCESSION', as: 'Concession', type: 'money' },
  ],
  calculated: [{ as: 'Amount', formula: '[Gross]-[Concession]', type: 'money' }],
};

const costs: SourceDef = {
  id: 'costs',
  label: 'Costs',
  required: false,
  match: { namePattern: 'Costs', requiredHeaders: ['Doctor', 'Salary Cost'] },
  sheet: {},
  headerRow: 'auto',
  columns: [
    { from: 'Doctor', as: 'Doctor', type: 'text' },
    { from: 'Salary Cost', as: 'Salary', type: 'money' },
  ],
  calculated: [],
};

const recipe: Recipe = { ...blankRecipe('Test'), sources: [opBilling, ipGeneral, costs] };

const opBillingFile = () =>
  hisWorkbook(
    'Sheet1',
    ['BILLNO', 'BILLDT', 'DOCTORNAME', 'NETAMOUNT'],
    [
      ['B1', new Date(Date.UTC(2026, 9, 1, 18, 30)), 'Dr A', 100.1], // 2 Oct IST
      ['B2', '03-OCT-2026', 'Dr B', 'n/a'], // unreadable amount
      [null, null, null, 100.1], // grand-total footer
    ],
  );

const ipGeneralFile = () =>
  hisWorkbook('Sheet1', ['BILLNO', 'BILLDT', 'DOCTORNAME', 'GROSSAMOUNT', 'CONCESSION'], [['G1', '04-10-2026', 'Dr A', 1000.1, 0.2]]);

const costsFile = () => hisWorkbook('Costs', ['Doctor', 'Salary Cost'], [['Dr A', 5000]]);

const read = (bytes: Uint8Array, def: SourceDef) => readSource({ name: 'f.xlsx', workbook: openWorkbook(bytes) }, def, {});

// ---- assignFiles ------------------------------------------------------------------------------

describe('assignFiles', () => {
  const probe = (name: string, headers: string[], sheet = 'Sheet1'): FileProbe => ({ name, sheets: [{ name: sheet, header: { rawHeaders: headers } }] });
  const op = probe('OP Billing Report Oct2026.xlsx', ['BILLNO', 'BILLDT', 'NETAMOUNT']);
  const ip = probe('IP General Bill Breakup Oct2026.xlsx', ['BILLNO', 'GROSSAMOUNT', 'CONCESSION']);

  it('matches by headers and reports a missing optional source separately', () => {
    const r = assignFiles([op, ip], recipe);
    expect(r.assignments.map((a) => [a.sourceId, a.how])).toEqual([
      ['opBilling', 'headers+name'],
      ['ipGeneral', 'headers+name'],
    ]);
    expect(r.missingRequiredSources).toEqual([]);
    expect(r.missingOptionalSources).toEqual(['costs']);
  });

  it('ignores months, years and dates in file names', () => {
    expect(normaliseFileName('IP Discharge Report Oct2026 (1).xlsx')).toBe('ip discharge report');
    expect(normaliseFileName('gst op pharmacy sales oct 2026.xlsx')).toBe('gst op pharmacy sales');
    const renamed = probe('OP Billing Report November 2027.xlsx', ['x']); // headers do not fit: the name decides
    expect(assignFiles([renamed], recipe).assignments).toEqual([{ sourceId: 'opBilling', fileName: renamed.name, how: 'name' }]);
  });

  it('lists missing required sources and unassigned files', () => {
    const r = assignFiles([op, probe('Mystery.xlsx', ['A'])], recipe);
    expect(r.missingRequiredSources).toEqual(['ipGeneral']);
    expect(r.unassignedFiles).toEqual(['Mystery.xlsx']);
  });

  it('asks when a file fits two sources, and when two files want one source', () => {
    const both = probe('Report.xlsx', ['BILLNO', 'NETAMOUNT', 'GROSSAMOUNT', 'CONCESSION']);
    const a = assignFiles([both], recipe);
    expect(a.assignments).toEqual([]);
    expect(a.ambiguous[0]?.candidates).toEqual(['opBilling', 'ipGeneral']);
    expect(a.missingRequiredSources).toEqual([]); // the user will choose, so they are not "missing"

    const twice = probe('OP Billing Report Oct2026 (1).xlsx', ['BILLNO', 'NETAMOUNT']);
    const b = assignFiles([op, twice, ip], recipe);
    expect(b.assignments.map((x) => x.sourceId)).toEqual(['ipGeneral']);
    expect(b.ambiguous.map((x) => x.fileName).sort()).toEqual([op.name, twice.name].sort());
  });

  it('looks in the sheet the source names, when it names one', () => {
    const wrongSheet: FileProbe = {
      name: 'x.xlsx',
      sheets: [
        { name: 'Sheet1', header: { rawHeaders: ['OTHER'] } },
        { name: 'Sheet2', header: { rawHeaders: ['BILLNO', 'NETAMOUNT'] } },
      ],
    };
    expect(assignFiles([wrongSheet], recipe).assignments).toEqual([]);
  });
});

// ---- readSource -------------------------------------------------------------------------------

describe('readSource', () => {
  it('reads, converts and counts: footer row filtered, bad amount blank + counted, IST date, paise', () => {
    const r = read(opBillingFile(), opBilling);
    expect(r.errors).toEqual([]);
    expect(r.headerRow).toBe(3);
    expect(r.stats).toMatchObject({ read: 3, filtered: 1, used: 2, blank: 0, unreadableByColumn: { Amount: 1 } });
    expect(r.rows.map((x) => x.row)).toEqual([4, 5]);
    expect(r.rows[0]?.values).toEqual({ Doctor: 'Dr A', Ref: 'B1', Date: '2026-10-02', Amount: 10010 });
    expect(r.rows[1]?.values.Amount).toBeNull();
    expect(r.unreadable).toEqual([{ row: 5, column: 'Amount', raw: 'n/a', reason: 'unreadable' }]);
  });

  it('keeps the footer row value for the tie-out check', () => {
    const r = read(opBillingFile(), opBilling);
    expect(r.footerRows).toEqual([{ row: 6, values: { Doctor: null, Ref: null, Date: null, Amount: 10010 } }]);
  });

  it('calculates columns exactly: 1000.10 - 0.20 is 99990 paise', () => {
    const r = read(ipGeneralFile(), ipGeneral);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]?.values).toMatchObject({ Gross: 100010, Concession: 20, Amount: 99990, Date: '2026-10-04' });
  });

  it('a missing column is a blocking error naming the source and column', () => {
    const bytes = hisWorkbook('Sheet1', ['BILLNO', 'BILLDT', 'DOCTORNAME', 'NET'], [['B1', '01-OCT-2026', 'Dr A', 5]]);
    const r = read(bytes, opBilling);
    expect(r.rows).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({
      level: 'error',
      sourceId: 'opBilling',
      column: 'NETAMOUNT',
      message: 'OP Billing: column NETAMOUNT not found. Pick the new column in Sources.',
    });
  });

  it('a formula that uses a missing column is a blocking error', () => {
    const def: SourceDef = { ...opBilling, rowFilter: 'NOT(ISBLANK([BILLNUMBER]))', uniqueColumn: undefined };
    const r = read(opBillingFile(), def);
    expect(r.errors.map((e) => e.message)).toEqual(['OP Billing: the row filter uses [BILLNUMBER], but column BILLNUMBER was not found. Pick the new column in Sources.']);
  });

  it('names a missing sheet and lists the ones that exist', () => {
    const r = read(opBillingFile(), { ...opBilling, sheet: { name: 'returns op' } });
    expect(r.errors[0]?.message).toMatch(/sheet “returns op” was not found.*“Sheet1”/);
  });

  it('refuses patient-detail columns', () => {
    const bytes = hisWorkbook('Sheet1', ['BILLNO', 'PATIENTNAME'], [['B1', 'Someone']]);
    const def: SourceDef = { ...opBilling, columns: [{ from: 'PATIENTNAME', as: 'Name', type: 'text' }], rowFilter: undefined, uniqueColumn: undefined };
    expect(read(bytes, def).errors[0]?.message).toMatch(/patient details/);
  });

  it('refuses reserved and repeated column names', () => {
    const def: SourceDef = { ...opBilling, columns: [{ from: 'BILLNO', as: 'Source', type: 'text' }, { from: 'DOCTORNAME', as: 'X', type: 'text' }, { from: 'BILLDT', as: 'x', type: 'text' }] };
    const messages = read(opBillingFile(), def).errors.map((e) => e.message);
    expect(messages.some((m) => m.includes('a name the app uses itself'))).toBe(true);
    expect(messages.some((m) => m.includes('two columns are called'))).toBe(true);
  });

  it('finds the header by itself in auto mode and picks columns by letter', () => {
    const def: SourceDef = { ...opBilling, headerRow: 'auto', columns: [{ from: 'D', as: 'Amount', type: 'money' }], rowFilter: undefined, uniqueColumn: undefined };
    const r = read(opBillingFile(), def);
    expect(r.headerRow).toBe(3);
    expect(r.rows[0]?.values.Amount).toBe(10010);
  });

  it('checks duplicate IDs only when the source asks for it', () => {
    const rows = [['B1', '01-OCT-2026', 'Dr A', 1], ['B1', '02-OCT-2026', 'Dr A', 2], ['B2', '02-OCT-2026', 'Dr A', 3]];
    const bytes = hisWorkbook('Sheet1', ['BILLNO', 'BILLDT', 'DOCTORNAME', 'NETAMOUNT'], rows);
    const on = read(bytes, opBilling);
    expect(on.stats.duplicateRows).toBe(2);
    expect(on.duplicates).toEqual([{ value: 'B1', rows: [4, 5] }]);
    const off = read(bytes, { ...opBilling, uniqueColumn: undefined });
    expect(off.stats.duplicateRows).toBe(0);
  });

  it('counts rows the filter could not judge instead of dropping them silently', () => {
    const def: SourceDef = { ...opBilling, rowFilter: '[NETAMOUNT] / 0 > 1', uniqueColumn: undefined };
    const r = read(opBillingFile(), def);
    expect(r.stats.filterErrors).toBe(3);
    expect(r.stats.used).toBe(0);
    expect(r.unreadable[0]).toMatchObject({ column: '(row filter)', reason: 'formulaError' });
  });

  it('reads PARAM values in formulas', () => {
    const def: SourceDef = { ...opBilling, calculated: [{ as: 'Month', formula: 'PARAM("Month")', type: 'text' }], uniqueColumn: undefined };
    const r = readSource({ name: 'f', workbook: openWorkbook(opBillingFile()) }, def, paramValues(recipe.parameters, { Month: 'Oct-2026' }));
    expect(r.rows[0]?.values.Month).toBe('Oct-2026');
  });
});

// ---- combine ----------------------------------------------------------------------------------

describe('combine', () => {
  const params = { Month: 'Oct-2026' };

  function readings() {
    return [
      { source: opBilling, fileName: 'op.xlsx', result: read(opBillingFile(), opBilling) },
      { source: ipGeneral, fileName: 'ip.xlsx', result: read(ipGeneralFile(), ipGeneral) },
      { source: costs, fileName: 'costs.xlsx', result: read(costsFile(), costs) },
    ];
  }

  it('stacks sources with different columns; missing columns are blank', () => {
    const { table, issues } = combine(readings(), recipe, params);
    expect(issues).toEqual([]);
    expect(table.columns.map((c) => c.name)).toEqual(['Doctor', 'Ref', 'Date', 'Amount', 'Gross', 'Concession', 'Salary', 'Source', '_file', '_row', 'Month']);
    expect(table.rows).toHaveLength(2 + 1 + 1);
    const ip = table.rows.find((r) => r.Source === 'IP General Bill');
    expect(ip).toMatchObject({ Doctor: 'Dr A', Amount: 99990, Salary: null, _file: 'ip.xlsx', _row: 4, Month: 'Oct-2026' });
    const cost = table.rows.find((r) => r.Source === 'Costs');
    expect(cost).toMatchObject({ Salary: 500000, Amount: null, Ref: null });
  });

  it('adds every parameter as a constant column (numbers as numbers)', () => {
    const r2: Recipe = { ...recipe, parameters: [...recipe.parameters, { name: 'Year', type: 'number', label: 'Year' }] };
    const { table } = combine(readings(), r2, { Month: 'Oct-2026', Year: '2026' });
    expect(table.rows.every((r) => r.Month === 'Oct-2026' && r.Year === 2026)).toBe(true);
  });

  it('rejects the same column name with different types', () => {
    const clash: SourceDef = { ...costs, columns: [{ from: 'Doctor', as: 'Doctor', type: 'text' }, { from: 'Salary Cost', as: 'Amount', type: 'text' }] };
    const rs = [readings()[0]!, { source: clash, fileName: 'c.xlsx', result: read(costsFile(), clash) }];
    const { issues } = combine(rs, recipe, params);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ level: 'error', column: 'Amount' });
    expect(issues[0]?.message).toMatch(/money in OP Billing but text in Costs/);
  });

  it('flags a parameter that has the same name as a column', () => {
    const r2: Recipe = { ...recipe, parameters: [{ name: 'Doctor', type: 'text', label: 'x' }] };
    expect(combine(readings(), r2, { Doctor: 'x' }).issues[0]?.message).toMatch(/same name as a column/);
  });

  it('leaves out a source that failed to read', () => {
    const bad = read(hisWorkbook('Sheet1', ['X'], []), opBilling);
    const { table } = combine([{ source: opBilling, fileName: 'op.xlsx', result: bad }], recipe, params);
    expect(table.rows).toEqual([]);
  });
});

// ---- the worker task --------------------------------------------------------------------------

describe('combineTask', () => {
  const assignments = () => [
    { sourceId: 'opBilling', file: asFile(opBillingFile(), 'OP Billing Report Oct2026.xlsx') },
    { sourceId: 'ipGeneral', file: asFile(ipGeneralFile(), 'IP General Bill Oct2026.xlsx') },
  ];

  it('combines the assigned files; an optional source without a file is an info note', async () => {
    const progress: string[] = [];
    const r = await combineTask({ recipe, params: { Month: 'Oct-2026' }, assignments: assignments() }, (p) => progress.push(p.stage));
    expect(r.totalRows).toBe(3);
    expect(r.sources.map((s) => [s.sourceId, s.stats.used, s.fileName])).toEqual([
      ['opBilling', 2, 'OP Billing Report Oct2026.xlsx'],
      ['ipGeneral', 1, 'IP General Bill Oct2026.xlsx'],
    ]);
    expect(r.issues).toEqual([{ level: 'info', sourceId: 'costs', message: expect.stringContaining('optional source') }]);
    expect(progress.at(-1)).toBe('Done');
    expect(r.sources[0]).not.toHaveProperty('rows');
  });

  it('a missing required source is an error; maxRows cuts the preview but not the total', async () => {
    const r = await combineTask({ recipe, params: { Month: 'Oct-2026' }, assignments: assignments().slice(0, 1), maxRows: 1 });
    expect(r.issues.find((i) => i.level === 'error')?.message).toMatch(/IP General Bill: no file was added/);
    expect(r.table.rows).toHaveLength(1);
    expect(r.totalRows).toBe(2);
  });
});
