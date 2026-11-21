import { describe, expect, it } from 'vitest';
import { defaultMappingFor } from '@/core/sourceDefaults';
import { sourceStatus } from '@/excel/sourceStatus';

const mapping = defaultMappingFor('opBilling');
const headers = ['BILLNO', 'BILLDT', 'UMRNO', 'DOCTORNAME', 'DEPARTMENTNAME', 'NETAMOUNT', 'BILLTYPE', 'ORGANIZATIONNAME'];
const loaded = (h: string[], sheet = 'Sheet1') => ({ sheet, sheetNames: [sheet], header: { rawHeaders: h, headers: h } });
const none = new Set<never>();

describe('sourceStatus', () => {
  it('is Not mapped until a mapping has been saved', () => {
    expect(sourceStatus(null, loaded(headers), none)).toMatchObject({ status: 'Not mapped', checkedAgainstFile: false });
  });

  it('is Ready when a mapping is saved and no file has been loaded yet', () => {
    expect(sourceStatus(mapping, null, none)).toMatchObject({ status: 'Ready', checkedAgainstFile: false });
  });

  it('is Ready when the file has every mapped column', () => {
    expect(sourceStatus(mapping, loaded(headers), none)).toMatchObject({ status: 'Ready', checkedAgainstFile: true, problems: [] });
  });

  it('is Flagged with the exact missing column when a column was renamed', () => {
    const renamed = headers.map((h) => (h === 'NETAMOUNT' ? 'NET_AMT' : h));
    const r = sourceStatus(mapping, loaded(renamed), none);
    expect(r.status).toBe('Flagged');
    expect(r.problems.map((p) => p.missingColumns)).toEqual([['NETAMOUNT']]);
  });

  it('is Flagged when the sheet is missing', () => {
    const r = sourceStatus(mapping, { sheet: 'Other', sheetNames: ['Other'], header: null }, none);
    expect(r.status).toBe('Flagged');
    expect(r.problems[0]?.message).toMatch(/sheet “Sheet1” was not found/);
  });

  it('is Flagged when the rules need a field the mapping does not provide', () => {
    const r = sourceStatus({ ...mapping, fields: { ref: mapping.fields.ref! } }, loaded(headers), new Set(['doctor'] as const));
    expect(r.status).toBe('Flagged');
    expect(r.problems[0]?.field).toBe('doctor');
  });
});
