// The reading rules from CLAUDE.md ("Reading rules every source needs"), on small made-up workbooks.

import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { convertValue } from '@/excel/convert';
import { detectHeader } from '@/excel/detectHeader';
import { isPatientColumn } from '@/excel/patient';
import { openWorkbook, readSheetRows } from '@/excel/readWorkbook';
import { ColumnIndex, compileFormula, evaluateFormula, recordContext, toBool, type Value } from '@/formula';
import { buildWorkbook } from '../helpers/syntheticWorkbook';

describe('convertValue', () => {
  it('reads text: trims, turns numbers and dates into text', () => {
    expect(convertValue('  Dr. A  ', 'text')).toMatchObject({ value: 'Dr. A', status: 'ok' });
    expect(convertValue(1234, 'text').value).toBe('1234');
    expect(convertValue(0.1 + 0.2, 'text').value).toBe('0.3');
    expect(convertValue(new Date(Date.UTC(2026, 9, 11, 18, 30)), 'text').value).toBe('2026-10-12');
    expect(convertValue('   ', 'text')).toMatchObject({ value: null, status: 'blank' });
    expect(convertValue(null, 'text').status).toBe('blank');
  });

  it('reads numbers, counting unreadable ones instead of dropping them', () => {
    expect(convertValue(5, 'number').value).toBe(5);
    expect(convertValue('1,234.5', 'number').value).toBe(1234.5);
    expect(convertValue('12%', 'number').value).toBe(0.12);
    expect(convertValue('abc', 'number')).toEqual({ value: null, status: 'unreadable', raw: 'abc' });
    expect(convertValue(true, 'number').status).toBe('unreadable');
  });

  it('reads money as integer paise', () => {
    expect(convertValue(1234.56, 'money').value).toBe(123456);
    expect(convertValue(0.1 + 0.2, 'money').value).toBe(30);
    expect(convertValue('₹1,23,456.78', 'money').value).toBe(12345678);
    expect(convertValue('Rs. 500/-', 'money').value).toBe(50000);
    expect(convertValue('(123)', 'money').value).toBe(-12300);
    expect(convertValue(-1.005, 'money').value).toBe(-101);
    expect(convertValue('12,34', 'money').status).toBe('unreadable'); // too ambiguous to trust
    expect(convertValue('n/a', 'money')).toMatchObject({ value: null, status: 'unreadable', raw: 'n/a' });
    expect(convertValue('', 'money').status).toBe('blank');
  });

  it('reads dates: Excel dates in India time, and the three text forms', () => {
    // SheetJS gives 12 Oct IST midnight as 11 Oct 18:30 UTC. Never slice the UTC string.
    expect(convertValue(new Date('2026-10-11T18:30:00Z'), 'date').value).toBe('2026-10-12');
    expect(convertValue(new Date('2026-10-12T00:00:00Z'), 'date').value).toBe('2026-10-12');
    expect(convertValue('02-OCT-2026', 'date').value).toBe('2026-10-02');
    expect(convertValue('02-Oct-2026', 'date').value).toBe('2026-10-02');
    expect(convertValue('02-10-2026', 'date').value).toBe('2026-10-02');
    expect(convertValue('2026-10-02', 'date').value).toBe('2026-10-02');
    expect(convertValue('31-02-2026', 'date').status).toBe('unreadable');
    expect(convertValue('soon', 'date')).toMatchObject({ status: 'unreadable', raw: 'soon' });
  });

  it('shortens long raw values in messages', () => {
    const r = convertValue('x'.repeat(100), 'number');
    expect(r.raw?.length).toBe(41);
  });
});

describe('patient columns', () => {
  it('flags names, phones and addresses but not doctors, bills or UMR numbers', () => {
    for (const h of ['PATIENTNAME', 'Mobile No', 'PHONE', 'ADDRESS1', 'Guardian', 'AADHAAR']) expect(isPatientColumn(h)).toBe(true);
    for (const h of ['DOCTORNAME', 'BILLNO', 'UMRNO', 'ORGANIZATIONNAME']) expect(isPatientColumn(h)).toBe(false);
  });
});

/** HIS-shaped: two title rows, header on row 3; a duplicate header, text dates, a formula cell and a footer. */
function hisWorkbook() {
  const ws = XLSX.utils.aoa_to_sheet(
    [
      ['G2 Health Care'],
      ['IP Bill Breakups'],
      ['BILLNO', 'ADMISSIONDT', 'DOCTORNAME', 'GROSS', 'DISC', 'NET', 'ADMISSIONDT', 'BILLDT'],
      ['B1', '02-OCT-2026', 'Dr A', 1000.1, 100.05, null, new Date(Date.UTC(2026, 9, 11, 18, 30)), '02-10-2026'],
      ['B2', '03-OCT-2026', 'Dr B', 'abc', 0, null, new Date(Date.UTC(2026, 9, 12)), '2026-10-03'],
      [null, null, null, 1000.1, 100.05, null, null, null], // grand-total footer: blank ID
    ],
    { cellDates: true },
  );
  ws['F4'] = { t: 'n', f: 'D4-E4', v: 900.05 };
  ws['F5'] = { t: 'n', f: 'D5-E5' }; // saved without a calculated value
  return buildWorkbook({ Sheet1: ws, Sheet2: XLSX.utils.aoa_to_sheet([]) });
}

describe('reading a HIS-shaped sheet', () => {
  const wb = openWorkbook(hisWorkbook());
  const sheet = readSheetRows(wb, 'Sheet1');
  const header = detectHeader(sheet.rows);

  it('finds the header on row 3 and makes the duplicate header unique', () => {
    expect(header?.headerRow).toBe(3);
    expect(header?.headers[1]).toBe('ADMISSIONDT');
    expect(header?.headers[6]).toBe('ADMISSIONDT (2)');
  });

  it('reads formula cells as their cached value, and counts the ones without one', () => {
    expect(sheet.rows[3]?.[5]).toBe(900.05);
    expect(sheet.rows[4]?.[5]).toBeNull();
    expect(sheet.stats.formulaCells).toBe(2);
    expect(sheet.stats.formulaCellsWithoutValue).toBe(1);
  });

  it('picks columns by name, by the "(2)" name of a duplicate, and by letter', () => {
    const cols = new ColumnIndex(header?.headers ?? []);
    expect(cols.find('ADMISSIONDT')).toBe(1);
    expect(cols.find('ADMISSIONDT (2)')).toBe(6);
    expect(cols.find('G')).toBe(6);
    expect(cols.find('admissiondt (2)')).toBe(6);
    expect(cols.find('NOPE')).toBeNull();
  });

  it('reads the typed values of each row, including dates in both forms', () => {
    const row1 = sheet.rows[3] ?? [];
    expect(convertValue(row1[1], 'date').value).toBe('2026-10-02'); // text DD-MON-YYYY
    expect(convertValue(row1[6], 'date').value).toBe('2026-10-12'); // Excel date, IST
    expect(convertValue(row1[7], 'date').value).toBe('2026-10-02'); // text DD-MM-YYYY
    expect(convertValue(sheet.rows[4]?.[7], 'date').value).toBe('2026-10-03'); // text ISO
    expect(convertValue(row1[3], 'money').value).toBe(100010);
    expect(convertValue(sheet.rows[4]?.[3], 'money')).toMatchObject({ status: 'unreadable', raw: 'abc' });
  });

  it('removes the footer row with a row filter and the blank-ID rule', () => {
    const cols = new ColumnIndex(header?.headers ?? []);
    const keep = compileFormula('NOT(ISBLANK([BILLNO]))');
    const dataRows = sheet.rows.slice(3);
    const kept = dataRows.filter((r) => toBool(keep.evaluate(cols.forRow(r as Value[]))));
    expect(kept).toHaveLength(2);
    expect(dataRows.length - kept.length).toBe(1); // counted as a footer / total row
  });

  it('evaluates a calculated column over original headers or letters', () => {
    const cols = new ColumnIndex(header?.headers ?? []);
    const row = (sheet.rows[3] ?? []) as Value[];
    const amount = compileFormula('[GROSS]-[DISC]').evaluate(cols.forRow(row));
    expect(convertValue(amount as number, 'money').value).toBe(90005);
    expect(compileFormula('[D]-[E]').evaluate(cols.forRow(row))).toBe(900.05);
  });
});

describe('TEXT, PARAM and STARTSWITH', () => {
  const ctx = recordContext(
    { D: '2026-10-05', IsoDate: new Date('2026-10-11T18:30:00Z'), Name: 'Pharmacy – Unattributed', Blank: null },
    { Month: 'Oct-2026', Year: 2026 },
  );
  const run = (f: string): Value => evaluateFormula(f, ctx);

  it('TEXT formats a date', () => {
    expect(run('TEXT([D], "YYYY-MM")')).toBe('2026-10');
    expect(run('TEXT([D], "MMM-YYYY")')).toBe('Oct-2026');
    expect(run('TEXT([D], "DD-MM-YYYY")')).toBe('05-10-2026');
    expect(run('TEXT([D], "mmmm yy")')).toBe('October 26');
    expect(run('TEXT([IsoDate], "DD-MM-YYYY")')).toBe('12-10-2026'); // an Excel date, in India time
    expect(run('TEXT([Blank], "YYYY-MM")')).toBe('');
  });

  it('TEXT explains a bad date or format', () => {
    expect(() => run('TEXT("soon", "YYYY")')).toThrow(/not a date/);
    expect(() => run('TEXT([D], "banana")')).toThrow(/not understood/);
  });

  it('PARAM returns the recipe parameter, ignoring case, and is never hidden by IFERROR', () => {
    expect(run('PARAM("Month")')).toBe('Oct-2026');
    expect(run('PARAM("month")')).toBe('Oct-2026');
    expect(run('PARAM("Year")+1')).toBe(2027);
    expect(run('TEXT([D], "MMM-YYYY") = PARAM("Month")')).toBe(true);
    expect(() => run('PARAM("Nope")')).toThrow(/parameter "Nope" was not found/);
    expect(() => run('IFERROR(PARAM("Nope"), "x")')).toThrow(/parameter/);
  });

  it('PARAM without any parameters is an error, not blank', () => {
    expect(() => evaluateFormula('PARAM("Month")', recordContext({}))).toThrow(/not found/);
  });

  it('STARTSWITH ignores case and accepts blanks', () => {
    expect(run('STARTSWITH([Name], "pharmacy")')).toBe(true);
    expect(run('STARTSWITH([Name], "Doctor")')).toBe(false);
    expect(run('STARTSWITH([Blank], "")')).toBe(true);
    expect(() => run('STARTSWITH([Name])')).toThrow();
  });
});
