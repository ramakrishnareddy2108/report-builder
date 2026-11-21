import { describe, expect, it } from 'vitest';
import { assignFiles } from '@/engine/assignFiles';
import { readSource } from '@/engine/readSource';
import { openWorkbook } from '@/excel/readWorkbook';
import { autoRequiredHeaders, guessType, idFromLabel, labelFromFileName, suggestName, uniqueSourceId, usedNames } from '@/recipe/guess';
import { createSourceFromSample, fromFor, pickableColumns, pickedColumn } from '@/pages/RecipeBuilder/sourceFactory';
import { sampleFromInspect } from '@/pages/RecipeBuilder/sample';
import { inspectFileTask } from '@/worker/tasks/inspectFile';
import { asFile, hisWorkbook } from '../helpers/syntheticWorkbook';

describe('guessType', () => {
  it('dates, money, plain numbers, IDs and text', () => {
    expect(guessType('BILLDT', [new Date(), new Date()])).toBe('date');
    expect(guessType('BILLDT', ['02-OCT-2026', '03-OCT-2026'])).toBe('date');
    expect(guessType('NETAMOUNT', [100, 250.5])).toBe('money');
    expect(guessType('Salary Cost', ['1,000', '2,000'])).toBe('money');
    expect(guessType('IPCOUNT', [1, 1, 2])).toBe('number');
    expect(guessType('BILLNO', [1001, 1002])).toBe('text'); // a bill number is an ID, not an amount
    expect(guessType('UMRNO', ['UMR1', 'UMR2'])).toBe('text');
    expect(guessType('DOCTORNAME', ['Dr A', 'Dr B'])).toBe('text');
    expect(guessType('X', [null, '', '  '])).toBe('text');
  });
});

describe('names and ids', () => {
  it('builds ids, labels and unique ids', () => {
    expect(idFromLabel('OP Billing Report')).toBe('opBillingReport');
    expect(idFromLabel('2026 data')).toBe('source2026Data');
    expect(uniqueSourceId(['opBilling'], 'opBilling')).toBe('opBilling2');
    expect(uniqueSourceId(['opBilling', 'opBilling2'], 'opBilling')).toBe('opBilling3');
    expect(labelFromFileName('IP Discharge Report Oct2026 (1).xlsx')).toBe('IP Discharge Report');
    expect(labelFromFileName('gst op pharmacy sales oct 2026.xlsx')).toBe('GST OP Pharmacy Sales');
    expect(labelFromFileName('2026.xlsx')).toBe('New source');
  });

  it('suggests the name another source already uses for the same header, so stacking lines up', () => {
    const others = [{ columns: [{ from: 'DOCTORNAME', as: 'Doctor', type: 'text' as const }] }];
    expect(suggestName('doctorname', others)).toBe('Doctor');
    expect(suggestName('NETAMOUNT', others)).toBe('NETAMOUNT');
    expect(suggestName('ADMISSIONDT (2)', others)).toBe('ADMISSIONDT');
    expect(usedNames([{ columns: [{ from: 'a', as: 'Zeta', type: 'text' }], calculated: [{ as: 'Alpha', formula: '1', type: 'number' }] }])).toEqual(['Alpha', 'Zeta']);
  });

  it('fills "columns the file must have" from the picked columns, skipping column letters', () => {
    expect(autoRequiredHeaders({ columns: [{ from: 'BILLNO', as: 'Ref', type: 'text' }, { from: 'AS', as: 'D', type: 'date' }, { from: 'BILLNO', as: 'R2', type: 'text' }, { from: 'ADMISSIONDT (2)', as: 'A', type: 'date' }, { from: 'admissiondt', as: 'B', type: 'date' }] })).toEqual(['BILLNO', 'ADMISSIONDT']);
  });
});

describe('adding a sample file to a recipe', () => {
  const HEADERS = ['BILLNO', 'BILLDT', 'PATIENTNAME', 'DOCTORNAME', 'NETAMOUNT', '', 'DOCTORNAME'];
  const bytes = hisWorkbook('Sheet1', HEADERS, [
    ['B1', '02-OCT-2026', 'Someone', 'Dr A', 100.1, null, 'x'],
    ['B2', '03-OCT-2026', 'Another', 'Dr B', 250, null, 'y'],
    [null, null, null, null, 350.1, null, null],
  ]);
  const file = asFile(bytes, 'OP Billing Report Oct2026.xlsx');

  it('reads the sample: header row, unique headers, preview rows', async () => {
    const sample = sampleFromInspect(file, await inspectFileTask({ file, maxRows: 70 }));
    expect(sample.headerRow).toBe(3);
    expect(sample.sheet).toBe('Sheet1');
    expect(sample.headers).toEqual(['BILLNO', 'BILLDT', 'PATIENTNAME', 'DOCTORNAME', 'NETAMOUNT', 'Column F', 'DOCTORNAME (2)']);
    expect(sample.rows).toHaveLength(3);
    expect(fromFor(sample, 5)).toBe('F'); // a blank header is referred to by its letter
    expect(fromFor(sample, 6)).toBe('DOCTORNAME (2)');
  });

  it('creates a source, picks columns (never patient data), and the source reads the file', async () => {
    const sample = sampleFromInspect(file, await inspectFileTask({ file, maxRows: 70 }));
    const source = createSourceFromSample(file.name, sample, []);
    expect(source).toMatchObject({ id: 'opBillingReport', label: 'OP Billing Report', required: true, headerRow: 3, sheet: { name: 'Sheet1' }, match: { namePattern: 'op billing report' } });

    const picks = pickableColumns(sample, new Set());
    expect(picks).toEqual([0, 1, 3, 4, 6]); // PATIENTNAME (2) is left out; the empty unnamed column F too
    source.columns = picks.map((i) => pickedColumn(sample, i, []));
    expect(source.columns.map((c) => [c.from, c.as, c.type])).toEqual([
      ['BILLNO', 'BILLNO', 'text'],
      ['BILLDT', 'BILLDT', 'date'],
      ['DOCTORNAME', 'DOCTORNAME', 'text'],
      ['NETAMOUNT', 'NETAMOUNT', 'money'],
      ['DOCTORNAME (2)', 'DOCTORNAME', 'text'],
    ]);
    source.columns[4] = { ...source.columns[4]!, as: 'Doctor2' };
    source.rowFilter = 'NOT(ISBLANK([BILLNO]))';
    source.match.requiredHeaders = autoRequiredHeaders(source);

    const r = readSource({ name: file.name, workbook: openWorkbook(bytes) }, source);
    expect(r.errors).toEqual([]);
    expect(r.stats).toMatchObject({ read: 3, filtered: 1, used: 2 });
    expect(r.rows[0]?.values).toMatchObject({ BILLNO: 'B1', BILLDT: '2026-10-02', NETAMOUNT: 10010, Doctor2: 'x' });
    expect(r.footerRows[0]?.values.NETAMOUNT).toBe(35010);
  });

  it('a second file with the same columns is recognised as that source; a different one is not', async () => {
    const sample = sampleFromInspect(file, await inspectFileTask({ file, maxRows: 70 }));
    const source = createSourceFromSample(file.name, sample, []);
    source.columns = pickableColumns(sample, new Set()).map((i) => pickedColumn(sample, i, []));
    source.match.requiredHeaders = autoRequiredHeaders(source);

    const next = asFile(hisWorkbook('Sheet1', HEADERS, [['B9', '05-NOV-2026', 'Z', 'Dr C', 5, null, 'q']]), 'OP Billing Report Nov2026.xlsx');
    const probe = (f: File, r: Awaited<ReturnType<typeof inspectFileTask>>) => ({ name: f.name, sheets: r.sheets });
    const a = assignFiles([probe(next, await inspectFileTask({ file: next }))], { sources: [source] });
    expect(a.assignments).toEqual([{ sourceId: 'opBillingReport', fileName: next.name, how: 'headers+name' }]);

    const other = asFile(hisWorkbook('Sheet1', ['X', 'Y'], [[1, 2]]), 'Something else.xlsx');
    const b = assignFiles([probe(other, await inspectFileTask({ file: other }))], { sources: [source] });
    expect(b.assignments).toEqual([]);
    expect(b.unassignedFiles).toEqual(['Something else.xlsx']);
  });
});
