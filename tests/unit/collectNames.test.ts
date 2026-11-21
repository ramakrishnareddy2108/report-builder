import { describe, expect, it } from 'vitest';
import { defaultMappingFor } from '@/core/sourceDefaults';
import { collectNamesTask } from '@/worker/tasks/collectNames';
import { hisFile } from '../helpers/syntheticWorkbook';

const BILLING = ['BILLNO', 'BILLDT', 'UMRNO', 'DOCTORNAME', 'DEPARTMENTNAME', 'NETAMOUNT', 'BILLTYPE', 'ORGANIZATIONNAME'];
const day = new Date(Date.UTC(2026, 9, 2));

describe('collectNamesTask', () => {
  it('counts doctor, department and sponsor spellings and ignores the grand-total row', async () => {
    const file = hisFile('OP Billing Report Oct2026.xlsx', BILLING, [
      ['B1', day, 'U1', ' dr a kumar', 'cardiology', 100, 'OP', 'GENERAL'],
      ['B2', day, 'U2', 'Dr A Kumar', 'CARDIOLOGY', 200, 'OP', 'STAR'],
      ['B3', day, 'U3', 'Dr A Kumar', 'CARDIOLOGY', 300, 'OP', 'GENERAL'],
      [null, null, null, null, null, 600, null, null],
    ]);
    const r = await collectNamesTask({
      sources: [{ sourceId: 'opBilling', file, mapping: defaultMappingFor('opBilling'), required: ['ref', 'doctor'] }],
    });
    expect(r.sources).toEqual([{ sourceId: 'opBilling', fileName: file.name, rows: 3, status: 'scanned' }]);
    expect(r.doctors).toEqual([
      { raw: 'Dr A Kumar', count: 2, departments: { CARDIOLOGY: 2 } },
      { raw: 'dr a kumar', count: 1, departments: { cardiology: 1 } },
    ]);
    expect(r.departments.map((d) => [d.raw, d.count])).toEqual([['CARDIOLOGY', 2], ['cardiology', 1]]);
    expect(r.sponsors.map((d) => [d.raw, d.count])).toEqual([['GENERAL', 2], ['STAR', 1]]);
  });

  it('reports a file that does not fit its mapping instead of reading it', async () => {
    const renamed = BILLING.map((h) => (h === 'DOCTORNAME' ? 'CONSULTANT' : h));
    const file = hisFile('OP Billing Report Oct2026.xlsx', renamed, [['B1', day, 'U1', 'Dr A', 'x', 1, 'OP', 'G']]);
    const r = await collectNamesTask({
      sources: [{ sourceId: 'opBilling', file, mapping: defaultMappingFor('opBilling'), required: [] }],
    });
    expect(r.sources[0]).toMatchObject({ status: 'flagged', rows: 0 });
    expect(r.sources[0]?.message).toMatch(/DOCTORNAME/);
    expect(r.doctors).toEqual([]);
  });

  it('reports a missing sheet', async () => {
    const file = hisFile('OP Billing Report Oct2026.xlsx', BILLING, [], 'Other');
    const r = await collectNamesTask({
      sources: [{ sourceId: 'opBilling', file, mapping: defaultMappingFor('opBilling'), required: [] }],
    });
    expect(r.sources[0]?.message).toMatch(/sheet “Sheet1” was not found/);
  });

  it('skips a source with no name columns mapped', async () => {
    const mapping = { ...defaultMappingFor('opReturns') };
    const file = hisFile('op returns report.xlsx', ['BILLNO', 'BILLDT', 'ORIGINAL_BILLNO', 'UMRNO', 'ADMISSIONNO', 'ORGANIZATIONNAME', 'SALEVALUE_BEFORETAX'], [['R1', day, 'B1', 'U1', null, 'GENERAL', 10]]);
    const noNames = { ...mapping, fields: { ref: mapping.fields.ref!, saleValue: mapping.fields.saleValue! } };
    const r = await collectNamesTask({ sources: [{ sourceId: 'opReturns', file, mapping: noNames, required: [] }] });
    expect(r.sources[0]?.status).toBe('noNames');
  });

  it('reports progress from 0 to 1 across files', async () => {
    const mk = (n: string) => hisFile(n, BILLING, [['B1', day, 'U1', 'Dr A', 'x', 1, 'OP', 'G']]);
    const seen: number[] = [];
    await collectNamesTask(
      {
        sources: [
          { sourceId: 'opBilling', file: mk('a.xlsx'), mapping: defaultMappingFor('opBilling'), required: [] },
          { sourceId: 'opBilling', file: mk('b.xlsx'), mapping: defaultMappingFor('opBilling'), required: [] },
        ],
      },
      (p) => seen.push(p.fraction),
    );
    expect(seen.at(-1)).toBe(1);
    expect(seen.every((f, i) => i === 0 || f >= (seen[i - 1] as number) - 1e-9)).toBe(true);
  });
});
