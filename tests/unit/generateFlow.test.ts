import { describe, expect, it } from 'vitest';
import { periodOf, previousMonthLabel, slotsFor } from '@/app/generateStore';
import { useHandoff } from '@/app/handoff';
import { useSession } from '@/app/sessionStore';
import type { FileProbe } from '@/engine/assignFiles';
import { assignFiles } from '@/engine/assignFiles';
import { buildSlots, defaultParamValue, NOT_USED, reportFileName } from '@/pages/Generate/assignments';
import { recipe } from '../helpers/syntheticRecipe';

const probe = (name: string, headers: string[], sheet = 'Sheet1'): FileProbe => ({ name, sheets: [{ name: sheet, header: { rawHeaders: headers } }] });

const R = recipe();
const billing = probe('OP Billing Report Oct2026.xlsx', ['BILLNO', 'NETAMOUNT', 'DOCTORNAME']);
const consult = probe('OP Consultations Report Oct2026.xlsx', ['CONSULTATIONNO']);
const pharmacy = probe('gst op pharmacy sales oct 2026.xlsx', ['SALEVALUE_BEFORETAX', 'ADMNNO'], 'OP pharmacy sales data');
const returns = probe('op returns report oct 2026.xlsx', ['ORIGINAL_BILLNO']);
const all = [billing, consult, pharmacy, returns];

describe('file slots on the Generate page', () => {
  it('fills every slot from the files and is ready (the optional source may stay empty)', () => {
    const s = slotsFor(R, all.map((p) => ({ file: new File([], p.name), probe: p })), {});
    expect(s.slots.map((x) => [x.sourceId, x.state])).toEqual([
      ['opBilling', 'ok'],
      ['opConsultations', 'ok'],
      ['opPharmacy', 'ok'],
      ['opReturns', 'ok'],
      ['costs', 'optional-missing'],
    ]);
    expect(s.assignments).toHaveLength(4);
    expect(s.ready).toBe(true);
    expect(s.unplaced).toEqual([]);
  });

  it('a missing required file is shown and blocks', () => {
    const s = slotsFor(R, [billing, consult].map((p) => ({ file: new File([], p.name), probe: p })), {});
    expect(s.slots.find((x) => x.sourceId === 'opPharmacy')?.state).toBe('missing');
    expect(s.ready).toBe(false);
  });

  it('a file that fits nothing is not used, does not block, and can still be placed by hand', () => {
    const items = [...all, probe('Mystery.xlsx', ['A'])];
    const auto = assignFiles(items, R);
    const names = items.map((i) => i.name);
    const base = buildSlots(R, names, auto, {});
    expect(base.ready).toBe(true);
    expect(base.ignored).toEqual(['Mystery.xlsx']);
    expect(base.unplaced).toEqual([]);

    const placed = buildSlots(R, names, auto, { 'Mystery.xlsx': 'costs' });
    expect(placed.ignored).toEqual([]);
    expect(placed.slots.find((x) => x.sourceId === 'costs')?.files).toEqual(['Mystery.xlsx']);
    expect(buildSlots(R, names, auto, { 'Mystery.xlsx': NOT_USED }).ignored).toEqual(['Mystery.xlsx']);
  });

  it('a file that could be two sources must be chosen: it blocks until then', () => {
    const both = probe('Report.xlsx', ['BILLNO', 'NETAMOUNT', 'CONSULTATIONNO']);
    const items = [billing.name === both.name ? billing : both, consult, pharmacy, returns];
    const names = items.map((i) => i.name);
    const auto = assignFiles(items, R);
    const s = buildSlots(R, names, auto, {});
    expect(s.ready).toBe(false);
    expect(s.unplaced[0]).toMatchObject({ fileName: 'Report.xlsx', candidates: ['opBilling', 'opConsultations'] });
    const chosen = buildSlots(R, names, auto, { 'Report.xlsx': 'opBilling' });
    expect(chosen.slots.find((x) => x.sourceId === 'opBilling')?.files).toEqual(['Report.xlsx']);
    expect(chosen.ready).toBe(true);
  });

  it('two files for one source are a conflict, and the user settles it', () => {
    const twice = probe('OP Billing Report Oct2026 (1).xlsx', ['BILLNO', 'NETAMOUNT']);
    const items = [...all, twice];
    const names = items.map((i) => i.name);
    const auto = assignFiles(items, R);
    const first = buildSlots(R, names, auto, {});
    expect(first.ready).toBe(false); // both are ambiguous, so neither is placed
    expect(first.unplaced.map((u) => u.fileName).sort()).toEqual([billing.name, twice.name].sort());

    const both = buildSlots(R, names, auto, { [billing.name]: 'opBilling', [twice.name]: 'opBilling' });
    expect(both.slots.find((x) => x.sourceId === 'opBilling')?.state).toBe('conflict');
    expect(both.ready).toBe(false);

    const settled = buildSlots(R, names, auto, { [billing.name]: 'opBilling', [twice.name]: NOT_USED });
    expect(settled.ready).toBe(true);
    expect(settled.assignments.find((a) => a.sourceId === 'opBilling')?.fileName).toBe(billing.name);
  });

  it('a manual choice beats the automatic one', () => {
    const s = buildSlots(R, all.map((p) => p.name), assignFiles(all, R), { [billing.name]: 'costs' });
    expect(s.slots.find((x) => x.sourceId === 'costs')?.files).toEqual([billing.name]);
    expect(s.slots.find((x) => x.sourceId === 'opBilling')?.state).toBe('missing');
  });
});

describe('names and defaults', () => {
  it('suggests the month before today for a Month question, and keeps a typed default', () => {
    expect(defaultParamValue({ name: 'Month', label: 'Report month' }, 'Oct-2026')).toBe('Oct-2026');
    expect(defaultParamValue({ name: 'Period', label: 'Which month?' }, 'Oct-2026')).toBe('Oct-2026');
    expect(defaultParamValue({ name: 'Month', label: 'x', default: 'Sep-2026' }, 'Oct-2026')).toBe('Sep-2026');
    expect(defaultParamValue({ name: 'Branch', label: 'Branch' }, 'Oct-2026')).toBe('');
    expect(previousMonthLabel()).toMatch(/^[A-Z][a-z]{2}-\d{4}$/);
  });

  it('names the file <Recipe>_<Month>.xlsx without characters Windows refuses', () => {
    expect(reportFileName('DRR', 'Oct-2026')).toBe('DRR_Oct-2026.xlsx');
    expect(reportFileName('Doctor-wise: Revenue / Report', 'Oct 2026')).toBe('Doctor-wise_Revenue_Report_Oct_2026.xlsx');
    expect(reportFileName('  ', '')).toBe('Report.xlsx');
  });

  it('the period of a report is the Month parameter, else the first one', () => {
    expect(periodOf(R, { Month: 'Oct-2026' })).toBe('Oct-2026');
    const other = { ...R, parameters: [{ name: 'Quarter', type: 'text' as const, label: 'Quarter' }] };
    expect(periodOf(other, { Quarter: 'Q2' })).toBe('Q2');
    expect(periodOf({ ...R, parameters: [] }, {})).toBe('');
  });
});

describe('in-memory hand-offs', () => {
  it('Fix mapping: the file is offered for one recipe and taken once', () => {
    const file = new File([], 'x.xlsx');
    useHandoff.getState().offer({ recipeId: 'r1', sourceId: 's1', file });
    expect(useHandoff.getState().take('other')).toBeNull();
    expect(useHandoff.getState().take('r1')?.file).toBe(file);
    expect(useHandoff.getState().take('r1')).toBeNull();
  });

  it('the last report lives in memory only', () => {
    useSession.getState().setLastReport({ recipeId: 'r', recipeName: 'DRR', period: 'Oct-2026', columns: [], rows: [] });
    expect(useSession.getState().lastReport?.period).toBe('Oct-2026');
    useSession.getState().setLastReport(null);
    expect(useSession.getState().lastReport).toBeNull();
  });
});
