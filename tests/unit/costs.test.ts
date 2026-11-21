import { describe, expect, it } from 'vitest';
import {
  MAX_COST_PAISE,
  anyAmounts,
  applyImport,
  costRows,
  costTotals,
  mapCostImport,
  orphanEntries,
  setEntry,
  suggestImportColumns,
  parseCostInput,
  toEntries,
} from '@/core/costs';
import { CostsFileSchema } from '@/core/schemas';
import type { CostEntry, DoctorMaster } from '@/core/types';

const doctors: DoctorMaster[] = [
  { id: 'a', displayName: 'A Kumar', department: null, aliases: ['Dr. A Kumar'] },
  { id: 'b', displayName: 'B Rao', department: null, aliases: [] },
];

describe('costRows / toEntries', () => {
  const entries: CostEntry[] = [
    { doctorId: 'b', amounts: { SALARY: 500000 }, note: 'March revision' },
    { doctorId: 'gone', amounts: { SALARY: 100 } },
  ];

  it('makes one row per doctor in master order, filled from the saved entries', () => {
    const rows = costRows(doctors, entries);
    expect(rows.map((r) => r.doctorId)).toEqual(['a', 'b']);
    expect(rows[0]).toEqual({ doctorId: 'a', amounts: {}, note: '' });
    expect(rows[1]).toEqual({ doctorId: 'b', amounts: { SALARY: 500000 }, note: 'March revision' });
  });

  it('keeps entries of doctors who left the master instead of dropping them', () => {
    const orphans = orphanEntries(doctors, entries);
    expect(orphans.map((e) => e.doctorId)).toEqual(['gone']);
    const saved = toEntries(costRows(doctors, entries), orphans);
    expect(saved.map((e) => e.doctorId)).toEqual(['b', 'gone']);
  });

  it('saves only rows that have an amount or a note, and the result passes the schema', () => {
    const rows = costRows(doctors, []);
    rows[0] = { doctorId: 'a', amounts: { INCENTIVES: 0 }, note: '  ' }; // an entered 0 is an amount
    const saved = toEntries(rows);
    expect(saved).toEqual([{ doctorId: 'a', amounts: { INCENTIVES: 0 } }]);
    const file = { version: 1, month: '2026-10', operatorName: 'Ram', updatedAt: '2026-11-02T10:00:00+05:30', entries: saved };
    expect(CostsFileSchema.safeParse(file).success).toBe(true);
  });

  it('totals each column in integer paise and knows when nothing is entered', () => {
    const rows = costRows(doctors, [
      { doctorId: 'a', amounts: { SALARY: 10, PROF_FEE: 5 } },
      { doctorId: 'b', amounts: { SALARY: 20 } },
    ]);
    expect(costTotals(rows)).toEqual({ DEPT_ISSUES: 0, SALARY: 30, INCENTIVES: 0, PROF_FEE: 5 });
    expect(anyAmounts(rows)).toBe(true);
    expect(anyAmounts(costRows(doctors, []))).toBe(false);
  });

  it('never loses a paisa adding many small amounts', () => {
    const rows = Array.from({ length: 1000 }, () => ({ doctorId: 'a', amounts: { SALARY: 10 }, note: '' }));
    expect(costTotals(rows).SALARY).toBe(10000);
  });
});

describe('parseCostInput', () => {
  it.each([
    ['12500', 1250000],
    ['12,500.50', 1250050],
    ['₹ 1,23,456', 12345600],
    ['(500)', -50000],
    ['0', 0],
  ])('%s → %s paise', (text, paise) => expect(parseCostInput(text)).toEqual({ ok: true, paise }));

  it('treats blank as not entered', () => {
    expect(parseCostInput('')).toEqual({ ok: true, paise: null });
    expect(parseCostInput('   ')).toEqual({ ok: true, paise: null });
  });

  it('rejects text with a plain message, and absurd amounts', () => {
    const bad = parseCostInput('twelve');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/“twelve” is not an amount/);
    expect(parseCostInput('9999999999999').ok).toBe(false);
    expect(parseCostInput(String(MAX_COST_PAISE / 100 + 1)).ok).toBe(false);
  });
});

describe('mapCostImport', () => {
  const sheet = [
    ['Costs for October'],
    ['Doctor', 'Issues', 'Salary', 'Incentive', 'Fee'],
    ['Dr. A Kumar', 100, '2,00,000', null, 'oops'],
    ['b rao', 50.5, 0, 10, 20],
    ['Somebody New', 1, 1, 1, 1],
    [null, null, null, null, null],
    ['Total', 151.5, 200000, 10, 20],
  ];
  const mapping = { headerRow: 2, doctorColumn: 0, columns: { DEPT_ISSUES: 1, SALARY: 2, INCENTIVES: 3, PROF_FEE: 4 } };

  it('matches doctors through the master and reads amounts as paise', () => {
    const r = mapCostImport(sheet, mapping, doctors);
    expect(r.amounts.get('a')).toEqual({ DEPT_ISSUES: 10000, SALARY: 20000000 }); // blank and bad cells are not applied
    expect(r.amounts.get('b')).toEqual({ DEPT_ISSUES: 5050, SALARY: 0, INCENTIVES: 1000, PROF_FEE: 2000 });
  });

  it('lists unknown names and unreadable cells instead of dropping them silently', () => {
    const r = mapCostImport(sheet, mapping, doctors);
    expect(r.unmatched).toEqual([{ raw: 'Somebody New', row: 5 }, { raw: 'Total', row: 7 }]);
    expect(r.badCells).toEqual([{ row: 3, cost: 'PROF_FEE', raw: 'oops' }]);
    expect(r.blankRows).toBe(1);
    expect(r.rowsRead).toBe(5);
  });

  it('applies none of the rows of a doctor listed twice', () => {
    const twice = [...sheet.slice(0, 4), ['A Kumar', 999, 999, 999, 999]];
    const r = mapCostImport(twice, mapping, doctors);
    expect(r.duplicates).toEqual([{ doctorId: 'a', rows: [3, 5] }]);
    expect(r.amounts.has('a')).toBe(false);
    expect(r.amounts.has('b')).toBe(true);
  });

  it('only touches the costs that were mapped', () => {
    const r = mapCostImport(sheet, { headerRow: 2, doctorColumn: 0, columns: { SALARY: 2 } }, doctors);
    expect(r.amounts.get('a')).toEqual({ SALARY: 20000000 });
    const rows = applyImport(costRows(doctors, [{ doctorId: 'a', amounts: { INCENTIVES: 7 } }]), r.amounts);
    expect(rows[0]?.amounts).toEqual({ INCENTIVES: 7, SALARY: 20000000 });
  });
});

describe('suggestImportColumns', () => {
  it('finds the doctor and cost columns from header text', () => {
    expect(suggestImportColumns(['S.No', 'Doctor Name', 'Departmental Issues Cost', 'Salary Cost', 'Incentives', 'Professional Fee'])).toEqual({
      doctorColumn: 1,
      columns: { DEPT_ISSUES: 2, SALARY: 3, INCENTIVES: 4, PROF_FEE: 5 },
    });
  });
  it('leaves out what it cannot find', () => {
    expect(suggestImportColumns(['Name', 'Salary'])).toEqual({ doctorColumn: 0, columns: { SALARY: 1 } });
    expect(suggestImportColumns(['a', 'b'])).toEqual({ doctorColumn: null, columns: {} });
  });
});

describe('setEntry', () => {
  const base: CostEntry[] = [{ doctorId: 'a', amounts: { SALARY: 100 }, note: 'old' }];

  it('adds, changes and keeps the order of the others', () => {
    const added = setEntry(base, 'b', { amounts: { SALARY: 5 } });
    expect(added.map((e) => e.doctorId)).toEqual(['a', 'b']);
    const changed = setEntry(added, 'a', { amounts: { SALARY: 200 } });
    expect(changed[0]).toEqual({ doctorId: 'a', amounts: { SALARY: 200 }, note: 'old' });
    expect(base[0]?.amounts.SALARY).toBe(100); // not mutated
  });

  it('changes only the note when only a note is given', () => {
    expect(setEntry(base, 'a', { note: ' new ' })[0]).toEqual({ doctorId: 'a', amounts: { SALARY: 100 }, note: 'new' });
  });

  it('removes an entry that is left with no amount and no note', () => {
    const cleared = setEntry(base, 'a', { amounts: {}, note: '' });
    expect(cleared).toEqual([]);
    expect(setEntry([], 'zzz', { amounts: {} })).toEqual([]);
  });

  it('keeps an entered zero, which is different from nothing entered', () => {
    expect(setEntry([], 'a', { amounts: { SALARY: 0 } })).toEqual([{ doctorId: 'a', amounts: { SALARY: 0 } }]);
  });
});
