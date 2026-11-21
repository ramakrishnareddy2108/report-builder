import { describe, expect, it } from 'vitest';
import { DEFAULT_SOURCE_MAPPINGS, defaultMappingFor } from '@/core/sourceDefaults';
import { requiredFields } from '@/core/rules';
import { loadDefaultRules } from '@/core/defaults';
import { SOURCE_IDS, type SourceMapping } from '@/core/types';
import { headersAt } from '@/excel/detectHeader';
import { columnLabel, columnMappingAt, readMappedRows, resolveMapping } from '@/excel/mapSource';
import type { Row } from '@/excel/readWorkbook';
import { DEFAULT_SOURCE_SIGNATURES } from '@/excel/identifySource';

// Two title rows, header on row 3 (like the HIS exports).
const HEADER: Row = ['BILLNO', 'BILLDT', 'DOCTORNAME', 'GROSSAMOUNT', 'CONCESSION', 'BILLSTATUS', 'BILLDT'];
const ROWS: Row[] = [
  ['G2 Health Care', null, null, null, null, null, null],
  ['IP report', null, null, null, null, null, null],
  HEADER,
  ['B1', '02-OCT-2026', ' dr a ', 1000.5, 100.25, 'CLEARED', new Date('2026-10-11T18:30:00Z')],
  ['B2', '03-OCT-2026', 'Dr B', '₹1,200', 0, 'PENDING', null],
  [null, null, null, null, null, null, null], // blank
  ['B3', 'garbage', 'Dr B', 'abc', null, 'CLEARED', null], // bad date + bad amount
  [null, null, null, 2201, 100, null, null], // grand-total footer
];

const header = headersAt(ROWS, 3);

function mapping(overrides: Partial<SourceMapping> = {}): SourceMapping {
  return {
    sourceId: 'ipGeneralBill',
    sheet: 'Sheet1',
    headerRow: 3,
    namePattern: 'IP General Bill Breakup',
    fields: {
      ref: { type: 'column', value: 'BILLNO' },
      txnDate: { type: 'column', value: 'BILLDT' },
      doctor: { type: 'column', value: 'DOCTORNAME' },
      grossAmount: { type: 'column', value: 'GROSSAMOUNT' },
      concession: { type: 'column', value: 'CONCESSION' },
      status: { type: 'column', value: 'BILLSTATUS' },
    },
    rowFilter: null,
    refUnique: true,
    ...overrides,
  };
}

describe('resolveMapping', () => {
  it('is clean when every column exists', () => {
    const r = resolveMapping(mapping(), header);
    expect(r.problems).toEqual([]);
    expect(r.fields.grossAmount).toEqual({ type: 'column', index: 3 });
  });

  it('matches header names ignoring case and extra spaces', () => {
    const m = mapping({ fields: { ref: { type: 'column', value: 'billno' } } });
    expect(resolveMapping(m, header).fields.ref).toEqual({ type: 'column', index: 0 });
  });

  it('flags a renamed column with its name, and never guesses', () => {
    const m = mapping({ fields: { ref: { type: 'column', value: 'BILLNO' }, grossAmount: { type: 'column', value: 'GROSS_AMT' } } });
    const r = resolveMapping(m, header);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatchObject({ field: 'grossAmount', missingColumns: ['GROSS_AMT'] });
    expect(r.fields.grossAmount).toBeUndefined();
  });

  it('picks the 2nd of a duplicate header, or a column by letter', () => {
    const second = mapping({ fields: { txnDate: { type: 'column', value: 'BILLDT', occurrence: 2 } } });
    expect(resolveMapping(second, header).fields.txnDate).toEqual({ type: 'column', index: 6 });
    const letter = mapping({ fields: { txnDate: { type: 'column', value: 'G', by: 'letter' } } });
    expect(resolveMapping(letter, header).fields.txnDate).toEqual({ type: 'column', index: 6 });
    const beyond = mapping({ fields: { txnDate: { type: 'column', value: 'Z', by: 'letter' } } });
    expect(resolveMapping(beyond, header).problems).toHaveLength(1);
  });

  it('reports a formula that uses a missing column, and a formula with a syntax error', () => {
    const m = mapping({
      fields: {
        grossAmount: { type: 'formula', value: '[GROSSAMOUNT] - [DISCOUNT]' },
        concession: { type: 'formula', value: '[CONCESSION] +' },
      },
      rowFilter: '[NOPE] = 1',
    });
    const r = resolveMapping(m, header);
    expect(r.problems.map((p) => p.field).sort()).toEqual(['concession', 'grossAmount', 'rowFilter']);
    expect(r.problems.find((p) => p.field === 'grossAmount')?.missingColumns).toEqual(['DISCOUNT']);
    expect(r.problems.find((p) => p.field === 'concession')?.message).toMatch(/not a valid formula/);
  });

  it('reports a field the rules need but that is not mapped', () => {
    const m = mapping({ fields: { ref: { type: 'column', value: 'BILLNO' }, sponsor: { type: 'none', value: null } } });
    const r = resolveMapping(m, header, new Set(['ref', 'sponsor', 'umrno'] as const));
    expect(r.problems.map((p) => p.field).sort()).toEqual(['sponsor', 'umrno']);
  });
});

describe('readMappedRows', () => {
  it('reads typed values: ISO dates, paise, trimmed text', () => {
    const sheet = readMappedRows(resolveMapping(mapping(), header), ROWS);
    const first = sheet.rows[0];
    expect(first?.row).toBe(4);
    expect(first?.values).toMatchObject({
      ref: 'B1',
      txnDate: '2026-10-02',
      doctor: 'dr a',
      grossAmount: 100050,
      concession: 10025,
      status: 'CLEARED',
    });
    expect(sheet.rows[1]?.values.grossAmount).toBe(120000); // "₹1,200"
  });

  it('counts every row that is not used, with a reason', () => {
    const sheet = readMappedRows(resolveMapping(mapping(), header), ROWS);
    expect(sheet.rowsRead).toBe(5);
    expect(sheet.rows.map((r) => r.row)).toEqual([4, 5, 7]);
    expect(sheet.skipped.map((s) => [s.row, s.reason])).toEqual([
      [6, 'blank'],
      [8, 'noReference'],
    ]);
    expect(sheet.rows.length + sheet.skipped.length).toBe(sheet.rowsRead);
  });

  it('keeps the values of a grand-total row for tie-out', () => {
    const sheet = readMappedRows(resolveMapping(mapping(), header), ROWS);
    expect(sheet.skipped.find((s) => s.reason === 'noReference')?.values?.grossAmount).toBe(220100);
  });

  it('records unreadable amounts and dates on the row instead of dropping it', () => {
    const sheet = readMappedRows(resolveMapping(mapping(), header), ROWS);
    const bad = sheet.rows.find((r) => r.row === 7);
    expect(bad?.values.grossAmount).toBeNull();
    expect(bad?.values.txnDate).toBeNull();
    expect(bad?.issues.map((i) => [i.field, i.kind])).toEqual([
      ['txnDate', 'badDate'],
      ['grossAmount', 'badAmount'],
    ]);
    expect(bad?.issues[1]?.raw).toBe('abc');
  });

  it('a blank amount is blank, not unreadable', () => {
    const bad = readMappedRows(resolveMapping(mapping(), header), ROWS).rows.find((r) => r.row === 7);
    expect(bad?.values.concession).toBeNull();
    expect(bad?.issues.some((i) => i.field === 'concession')).toBe(false);
  });

  it('applies the row filter and counts the rows it removes', () => {
    const m = mapping({ rowFilter: '[BILLSTATUS] = "CLEARED"' });
    const sheet = readMappedRows(resolveMapping(m, header), ROWS);
    expect(sheet.rows.map((r) => r.row)).toEqual([4, 7]);
    expect(sheet.skipped.find((s) => s.row === 5)?.reason).toBe('filtered');
  });

  it('skips a row whose filter cannot be evaluated, and says so', () => {
    const m = mapping({ rowFilter: '[GROSSAMOUNT] + 1 > 0' });
    const sheet = readMappedRows(resolveMapping(m, header), ROWS);
    const skipped = sheet.skipped.find((s) => s.row === 7);
    expect(skipped?.reason).toBe('filterError');
    expect(skipped?.message).toMatch(/not a number/);
  });

  it('evaluates formula fields and fixed values', () => {
    const m = mapping({
      fields: {
        ref: { type: 'column', value: 'BILLNO' },
        netAmount: { type: 'formula', value: '[GROSSAMOUNT] - [CONCESSION]' },
        sponsor: { type: 'fixed', value: 'GENERAL' },
        saleValue: { type: 'fixed', value: 12.5 },
      },
    });
    const first = readMappedRows(resolveMapping(m, header), ROWS).rows[0];
    expect(first?.values).toMatchObject({ netAmount: 90025, sponsor: 'GENERAL', saleValue: 1250 });
  });

  it('records a formula error on the row', () => {
    const m = mapping({ fields: { ref: { type: 'column', value: 'BILLNO' }, netAmount: { type: 'formula', value: '[GROSSAMOUNT] / 0' } } });
    const first = readMappedRows(resolveMapping(m, header), ROWS).rows[0];
    expect(first?.values.netAmount).toBeNull();
    expect(first?.issues[0]).toMatchObject({ field: 'netAmount', kind: 'formulaError' });
  });

  it('reads Excel dates as IST calendar days', () => {
    const m = mapping({ fields: { ref: { type: 'column', value: 'BILLNO' }, txnDate: { type: 'column', value: 'BILLDT', occurrence: 2 } } });
    expect(readMappedRows(resolveMapping(m, header), ROWS).rows[0]?.values.txnDate).toBe('2026-10-12');
  });

  it('turns numeric ids into text without ".0"', () => {
    const rows: Row[] = [['ID', 'AMT'], [12345, 1], [1.5e3, 2]];
    const m = mapping({ headerRow: 1, fields: { ref: { type: 'column', value: 'ID' } } });
    const sheet = readMappedRows(resolveMapping(m, headersAt(rows, 1)), rows);
    expect(sheet.rows.map((r) => r.values.ref)).toEqual(['12345', '1500']);
  });

  it('limits the rows read for previews', () => {
    const sheet = readMappedRows(resolveMapping(mapping(), header), ROWS, { maxRows: 2 });
    expect(sheet.rowsRead).toBe(2);
    expect(sheet.rows).toHaveLength(2);
  });

  it('works without a ref field (nothing is treated as a total row)', () => {
    const m = mapping({ fields: { grossAmount: { type: 'column', value: 'GROSSAMOUNT' } } });
    const sheet = readMappedRows(resolveMapping(m, header), ROWS);
    expect(sheet.skipped.map((s) => s.reason)).toEqual(['blank']);
    expect(sheet.rows).toHaveLength(4);
  });
});

describe('default mappings', () => {
  it('cover all 8 sources and agree with the identification signatures', () => {
    expect(DEFAULT_SOURCE_MAPPINGS.map((m) => m.sourceId).sort()).toEqual([...SOURCE_IDS].sort());
    for (const m of DEFAULT_SOURCE_MAPPINGS) {
      const sig = DEFAULT_SOURCE_SIGNATURES.find((s) => s.sourceId === m.sourceId);
      expect(m.namePattern).toBe(sig?.namePattern);
      expect(m.sheet).toBe(sig?.sheet);
      // Every key column the signature lists is mapped.
      const mapped = Object.values(m.fields).map((f) => (f?.type === 'column' ? f.value.toUpperCase() : ''));
      for (const h of sig?.headers ?? []) expect(mapped, `${m.sourceId} ${h}`).toContain(h.toUpperCase());
    }
  });

  it('uses the source-specific column names from CLAUDE.md', () => {
    expect(defaultMappingFor('ipGeneralBill').fields.sponsor).toEqual({ type: 'column', value: 'ORGNAME' });
    expect(defaultMappingFor('opPharmacySales').fields.admissionNo).toEqual({ type: 'column', value: 'ADMNNO' });
    expect(defaultMappingFor('opReturns').fields.admissionNo).toEqual({ type: 'column', value: 'ADMISSIONNO' });
    expect(defaultMappingFor('opPharmacySales').refUnique).toBe(false);
    expect(defaultMappingFor('opReturns').refUnique).toBe(false);
  });

  it('give the rules every field they need (nothing is left unmapped)', () => {
    const rules = loadDefaultRules();
    for (const m of DEFAULT_SOURCE_MAPPINGS) {
      const missing = [...requiredFields(rules, m.sourceId)].filter((f) => !m.fields[f] || m.fields[f]?.type === 'none');
      expect(missing, m.sourceId).toEqual([]);
    }
  });
});

describe('requiredFields', () => {
  const rules = loadDefaultRules();

  it('lists what the active rules read from a source', () => {
    expect([...requiredFields(rules, 'ipGeneralBill')].sort()).toEqual(
      ['concession', 'department', 'doctor', 'grossAmount', 'ref', 'sponsor', 'status', 'txnDate'].sort(),
    );
    expect([...requiredFields(rules, 'opPharmacySales')].sort()).toEqual(
      ['admissionNo', 'purchaseValue', 'ref', 'saleValue', 'sponsor', 'txnDate', 'umrno'].sort(),
    );
  });

  it('needs nothing from a source no rule uses', () => {
    expect(requiredFields(rules, 'ipAdmissions').size).toBe(0);
  });

  it('needs consultations for pharmacy attribution even when OP revenue ignores them', () => {
    expect(rules.flags.includeConsultations).toBe(false);
    expect([...requiredFields(rules, 'opConsultations')].sort()).toEqual(['department', 'doctor', 'ref', 'txnDate', 'umrno']);
  });

  it('skips terms whose flag is off and adds them when it is on', () => {
    const on = { ...rules, flags: { ...rules.flags, includeConsultations: true } };
    expect(requiredFields(on, 'opConsultations').has('netAmount')).toBe(true);
    expect(requiredFields(rules, 'opConsultations').has('netAmount')).toBe(false);
  });
});

describe('columnMappingAt', () => {
  const raw = ['BILLNO', 'ADMISSIONDT', '', 'admissiondt'];
  it('maps by header text, numbers repeated headers, and falls back to the letter for blank headers', () => {
    expect(columnMappingAt(raw, 0)).toEqual({ type: 'column', value: 'BILLNO' });
    expect(columnMappingAt(raw, 1)).toEqual({ type: 'column', value: 'ADMISSIONDT' });
    expect(columnMappingAt(raw, 3)).toEqual({ type: 'column', value: 'admissiondt', occurrence: 2 });
    expect(columnMappingAt(raw, 2)).toEqual({ type: 'column', value: 'C', by: 'letter' });
  });
  it('round-trips through resolveMapping', () => {
    const h = { rawHeaders: raw, headers: ['BILLNO', 'ADMISSIONDT', 'Column C', 'admissiondt (2)'] };
    for (let i = 0; i < raw.length; i++) {
      const m = mapping({ fields: { ref: columnMappingAt(raw, i) } });
      expect(resolveMapping(m, h).fields.ref).toEqual({ type: 'column', index: i });
    }
  });
  it('labels columns with their letter', () => {
    expect(columnLabel(raw, 0)).toBe('A · BILLNO');
    expect(columnLabel(raw, 2)).toBe('C · (no header)');
  });
});
