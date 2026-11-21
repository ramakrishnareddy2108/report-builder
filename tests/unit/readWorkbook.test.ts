import { describe, expect, it } from 'vitest';
import { sha256Hex } from '@/excel/fingerprint';
import { listSheets, openWorkbook, readSheetRows, WorkbookReadError } from '@/excel/readWorkbook';
import { consultationsWorkbook } from '../helpers/syntheticWorkbook';

describe('openWorkbook / listSheets', () => {
  it('returns every sheet name with its used size from A1', () => {
    const wb = openWorkbook(consultationsWorkbook());
    expect(listSheets(wb)).toEqual([
      { name: 'Sheet1', rowCount: 6, columnCount: 11 },
      { name: 'Sheet2', rowCount: 0, columnCount: 0 },
      { name: 'Offset', rowCount: 6, columnCount: 4 },
    ]);
  });

  it('explains files that are not workbooks in plain language', () => {
    expect(() => openWorkbook(new Uint8Array())).toThrow(WorkbookReadError);
    expect(() => openWorkbook(new Uint8Array())).toThrow('The file is empty.');
  });
});

describe('readSheetRows', () => {
  const wb = openWorkbook(consultationsWorkbook());

  it('aligns rows to Excel row numbers: rows[0] is row 1, header on row 3', () => {
    const { rows, rowCount, columnCount } = readSheetRows(wb, 'Sheet1');
    expect(rowCount).toBe(6);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.length === columnCount)).toBe(true);
    expect(rows[0]![0]).toBe('G2 Health Care');
    expect(rows[1]![1]).toBeNull();
    expect(rows[2]![0]).toBe('CONSULTATIONNO');
    expect(rows[3]![0]).toBe('C001');
    expect(rows[4]![3]).toBe(' dr b rao'); // raw text is kept as is
  });

  it('reads formula cells as their cached values', () => {
    const { rows, stats } = readSheetRows(wb, 'Sheet1');
    expect(rows[3]![7]).toBe(450);
    expect(rows[4]![7]).toBe(300);
    expect(rows[5]![7]).toBe(750);
    expect(stats).toEqual({ formulaCells: 3, formulaCellsWithoutValue: 0, errorCells: 0 });
  });

  it('counts formula cells saved without a calculated value', () => {
    const wb2 = openWorkbook(consultationsWorkbook({ withoutCachedValue: true }));
    const { rows, stats } = readSheetRows(wb2, 'Sheet1');
    expect(rows[3]![7]).toBeNull();
    expect(stats.formulaCellsWithoutValue).toBe(1);
  });

  it('returns Excel dates as Date objects (cellDates)', () => {
    const { rows } = readSheetRows(wb, 'Sheet1');
    expect(rows[3]![1]).toBeInstanceOf(Date);
  });

  it('starts at A1 even when the used range does not', () => {
    const { rows } = readSheetRows(wb, 'Offset');
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual([null, null, null, null]);
    expect(rows[4]).toEqual([null, null, 'BILLNO', 'AMOUNT']);
    expect(rows[5]).toEqual([null, null, 'B1', 10]);
  });

  it('can stop after N rows and reports progress', () => {
    const calls: [number, number][] = [];
    const { rows } = readSheetRows(wb, 'Sheet1', { maxRows: 3, progressEvery: 2, onProgress: (d, t) => calls.push([d, t]) });
    expect(rows).toHaveLength(3);
    expect(calls).toEqual([[2, 3], [3, 3]]);
  });

  it('names the available sheets when the sheet is missing', () => {
    expect(() => readSheetRows(wb, 'Nope')).toThrow(/“Nope” was not found.*“Sheet1”, “Sheet2”, “Offset”/);
  });
});

describe('sha256Hex', () => {
  it('matches the known digest of "abc"', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
