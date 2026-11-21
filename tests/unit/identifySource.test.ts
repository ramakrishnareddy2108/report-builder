import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOURCE_SIGNATURES,
  identifySource,
  matchNamePattern,
  nameTokens,
  signatureFromMapping,
  type SheetHeaders,
} from '@/excel/identifySource';
import { SOURCE_IDS } from '@/core/types';

const sigFor = (id: string) => DEFAULT_SOURCE_SIGNATURES.find((s) => s.sourceId === id)!;
const sheet = (name: string, headers: string[]): SheetHeaders => ({ sheet: name, headerRow: 3, headers });

describe('nameTokens', () => {
  it('drops extension, month names, years, dates and copy numbers', () => {
    expect(nameTokens('IP Discharge Report Oct2026.xlsx')).toEqual(['ip', 'discharge', 'report']);
    expect(nameTokens('gst op pharmacy sales oct 2026 (1).xlsx')).toEqual(['gst', 'op', 'pharmacy', 'sale']);
    expect(nameTokens('op returns report 01-11-2026.xls')).toEqual(['op', 'return', 'report']);
    expect(nameTokens('OP_Billing_Report_SEPTEMBER_2026.xlsx')).toEqual(['op', 'billing', 'report']);
    expect(nameTokens('IP Admissions report 02-OCT-2026 to 31-OCT-2026.xlsx')).toEqual(['ip', 'admission', 'report', 'to']);
  });
});

describe('matchNamePattern', () => {
  it('scores exact 1, contained 0.9, otherwise 0', () => {
    expect(matchNamePattern('IP Bill Breakups oct2026.xlsx', 'IP Bill Breakups')).toBe(1);
    expect(matchNamePattern('Copy of IP Bill Breakup Nov 2026.xlsx', 'IP Bill Breakups')).toBe(0.9);
    // "IP General Bill Breakup" must not be taken for "IP Bill Breakups" or the other way round.
    expect(matchNamePattern('IP General Bill Breakup Oct2026.xlsx', 'IP Bill Breakups')).toBe(0);
    expect(matchNamePattern('IP Bill Breakups oct2026.xlsx', 'IP General Bill Breakup')).toBe(0);
  });
});

describe('identifySource by file name', () => {
  const files: [string, string][] = [
    ['IP Admissions report oct2026.xlsx', 'ipAdmissions'],
    ['IP Bill Breakups oct2026.xlsx', 'ipBillBreakups'],
    ['IP Discharge Report Oct2026.xlsx', 'ipDischarge'],
    ['IP General Bill Breakup Oct2026.xlsx', 'ipGeneralBill'],
    ['OP Billing Report Oct2026.xlsx', 'opBilling'],
    ['OP Consultations Report Oct2026.xlsx', 'opConsultations'],
    ['gst op pharmacy sales oct 2026.xlsx', 'opPharmacySales'],
    ['op returns report oct 2026.xlsx', 'opReturns'],
  ];

  it.each(files)('%s → %s with full confidence when the columns agree', (name, id) => {
    const r = identifySource(name, [sheet(sigFor(id).sheet!, sigFor(id).headers)]);
    expect(r.sourceId).toBe(id);
    expect(r.method).toBe('name');
    expect(r.confidence).toBe(1);
  });

  it('picks the pharmacy data sheet out of the pivot sheets', () => {
    const sig = sigFor('opPharmacySales');
    const r = identifySource('gst op pharmacy sales oct 2026.xlsx', [
      sheet('Pivot', ['Row Labels', 'Sum of SALEVALUE_BEFORETAX']),
      sheet('Summary', ['ORGANIZATIONNAME', 'Total']),
      sheet('OP pharmacy sales data', sig.headers),
      sheet('Sheet4', []),
    ]);
    expect(r.sheet).toBe('OP pharmacy sales data');
  });

  it('prefers Sheet1 over the hand-filtered "returns op" copy with the same headers', () => {
    const sig = sigFor('opReturns');
    const r = identifySource('op returns report oct 2026.xlsx', [sheet('returns op', sig.headers), sheet('Sheet1', sig.headers)]);
    expect(r.sheet).toBe('Sheet1');
  });

  it('lowers confidence when the columns are missing or point elsewhere', () => {
    const partial = identifySource('OP Billing Report.xlsx', [sheet('Sheet1', ['BILLNO', 'BILLDT', 'UMRNO', 'DOCTORNAME', 'DEPARTMENTNAME'])]);
    expect(partial.sourceId).toBe('opBilling');
    expect(partial.confidence).toBe(0.75);
    expect(partial.reason).toMatch(/NETAMOUNT, BILLTYPE, ORGANIZATIONNAME/);

    const conflict = identifySource('OP Billing Report.xlsx', [sheet('Sheet1', sigFor('ipGeneralBill').headers)]);
    expect(conflict.confidence).toBeLessThan(0.6);
    expect(conflict.reason).toMatch(/IP General Bill Breakup/);
  });
});

describe('identifySource by headers', () => {
  it('falls back to header overlap when the name is unknown', () => {
    const r = identifySource('export (3).xlsx', [sheet('Sheet1', [...sigFor('ipGeneralBill').headers, 'UMRNO', 'EXTRA'])]);
    expect(r.sourceId).toBe('ipGeneralBill');
    expect(r.method).toBe('headers');
    expect(r.confidence).toBe(0.9);
    expect(r.candidates).toHaveLength(SOURCE_IDS.length);
  });

  it('tells discharge from admissions when a discharge file also has ADMISSIONDT', () => {
    const r = identifySource('report.xlsx', [sheet('Sheet1', [...sigFor('ipDischarge').headers, 'ADMISSIONDT'])]);
    expect(r.sourceId).toBe('ipDischarge');
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('asks the user when the columns fit two sources equally', () => {
    // opPharmacySales and opReturns share most columns; this has none of the distinctive ones.
    const r = identifySource('data.xlsx', [sheet('Sheet1', ['BILLNO', 'BILLDT', 'UMRNO', 'ORGANIZATIONNAME', 'SALEVALUE_BEFORETAX'])]);
    expect(r.confidence).toBeLessThan(0.6);
  });

  it('returns no source when nothing matches', () => {
    const r = identifySource('holiday photos.xlsx', [sheet('Sheet1', ['A', 'B'])]);
    expect(r).toMatchObject({ sourceId: null, sheet: null, confidence: 0, method: 'none' });
  });
});

describe('signatureFromMapping', () => {
  it('takes header-type column fields only', () => {
    const sig = signatureFromMapping({
      sourceId: 'ipBillBreakups',
      sheet: 'Sheet1',
      headerRow: 3,
      namePattern: 'IP Bill Breakups',
      fields: {
        ref: { type: 'column', value: 'BILLNO' },
        txnDate: { type: 'column', value: 'C', by: 'letter' },
        doctor: { type: 'column', value: 'DOCTORNAME' },
        sponsor: { type: 'fixed', value: 'GENERAL' },
        netAmount: { type: 'formula', value: '[GROSS]' },
        status: { type: 'none', value: null },
      },
      rowFilter: null,
      refUnique: true,
    });
    expect(sig).toEqual({ sourceId: 'ipBillBreakups', namePattern: 'IP Bill Breakups', sheet: 'Sheet1', headers: ['BILLNO', 'DOCTORNAME'] });
  });
});
