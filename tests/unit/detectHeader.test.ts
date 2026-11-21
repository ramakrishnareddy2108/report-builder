import { describe, expect, it } from 'vitest';
import {
  columnIndex,
  columnLetter,
  detectHeader,
  detectHeaderRow,
  findHeaderColumn,
  headersAt,
  isHeaderLikeText,
  makeUniqueHeaders,
} from '@/excel/detectHeader';
import { openWorkbook, readSheetRows } from '@/excel/readWorkbook';
import { consultationsWorkbook } from '../helpers/syntheticWorkbook';

describe('column letters', () => {
  it('converts both ways', () => {
    expect([0, 5, 25, 26, 33, 701, 702].map(columnLetter)).toEqual(['A', 'F', 'Z', 'AA', 'AH', 'ZZ', 'AAA']);
    expect(['A', 'f', 'AH', 'AAA'].map(columnIndex)).toEqual([0, 5, 33, 702]);
    expect(columnIndex('A1')).toBeNull();
  });
});

describe('detectHeaderRow', () => {
  it('finds the header on row 3 of a synthetic HIS export', () => {
    const { rows } = readSheetRows(openWorkbook(consultationsWorkbook()), 'Sheet1');
    expect(detectHeaderRow(rows)).toBe(3);
  });

  it('does not count numbers, numeric text or text dates', () => {
    expect(['123', '1,234.50', '-5', '50%', '02-OCT-2026', '2026-10-02', 'NAME'].map(isHeaderLikeText)).toEqual([
      false, false, false, false, false, false, true,
    ]);
    const rows = [
      ['Title'],
      ['A', 'B'],
      ['C001', '02-OCT-2026', '100', '200', 5],
    ];
    expect(detectHeaderRow(rows)).toBe(2);
  });

  it('picks the earliest row on a tie and only scans the first 20 rows', () => {
    expect(detectHeaderRow([['A', 'B'], ['C', 'D']])).toBe(1);
    const rows = [...Array.from({ length: 20 }, () => ['x']), ['A', 'B', 'C', 'D']];
    expect(detectHeaderRow(rows)).toBe(1);
    expect(detectHeaderRow(rows, 21)).toBe(21);
  });

  it('returns null when there is no text', () => {
    expect(detectHeaderRow([[1, 2], [null]])).toBeNull();
    expect(detectHeader([])).toBeNull();
  });
});

describe('makeUniqueHeaders', () => {
  it('names blanks by column letter and suffixes duplicates', () => {
    expect(makeUniqueHeaders(['ADMISSIONDT', null, '  Net   Amount ', 'admissiondt', 'ADMISSIONDT', ''])).toEqual([
      'ADMISSIONDT',
      'Column B',
      'Net Amount',
      'admissiondt (2)',
      'ADMISSIONDT (3)',
      'Column F',
    ]);
  });

  it('never produces the same name twice, even against generated names', () => {
    const out = makeUniqueHeaders(['Column B', null, 'X', 'X (2)', 'X']);
    expect(new Set(out.map((h) => h.toUpperCase())).size).toBe(out.length);
  });

  it('pads to the column count', () => {
    expect(makeUniqueHeaders(['A'], 3)).toEqual(['A', 'Column B', 'Column C']);
  });
});

describe('detectHeader', () => {
  it('returns unique and raw headers for the synthetic sheet', () => {
    const { rows } = readSheetRows(openWorkbook(consultationsWorkbook()), 'Sheet1');
    const h = detectHeader(rows)!;
    expect(h.headerRow).toBe(3);
    expect(h.headers.slice(7)).toEqual(['Net Amount', 'ORGANIZATIONNAME', 'Column J', 'DOCTORNAME (2)']);
    expect(h.rawHeaders[9]).toBe('');
    expect(h.rawHeaders[10]).toBe('DOCTORNAME');
  });

  it('can use a chosen header row', () => {
    expect(headersAt([['T'], ['A', 'B']], 2).headers).toEqual(['A', 'B']);
  });
});

describe('findHeaderColumn', () => {
  const raw = ['BILLNO', 'ADMISSIONDT', 'X', 'AdmissionDt'];
  it('finds by name and occurrence, exact first then ignoring case', () => {
    expect(findHeaderColumn(raw, 'BILLNO')).toBe(0);
    expect(findHeaderColumn(raw, 'billno')).toBe(0);
    expect(findHeaderColumn(raw, 'ADMISSIONDT', 2)).toBe(3);
    expect(findHeaderColumn(raw, 'MISSING')).toBeNull();
  });
});
