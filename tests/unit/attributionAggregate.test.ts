import { describe, expect, it } from 'vitest';
import { NONE_KEY, UNMATCHED_KEY, pivot, sumFacts, totalValues } from '@/core/aggregate';
import { UNATTRIBUTED, ConsultationIndex } from '@/core/attribution';
import type { CostEntry, DoctorMaster, FactRow } from '@/core/types';
import type { MappedRow } from '@/excel/mapSource';

const consult = (row: number, umrno: string | null, date: string | null, doctor: string | null, department: string | null = 'CARDIO'): MappedRow => ({
  row,
  values: { umrno, txnDate: date, doctor, department },
  issues: [],
});

describe('ConsultationIndex.lookup', () => {
  const index = new ConsultationIndex([
    consult(4, 'U1', '2026-10-02', 'Dr A'),
    consult(5, 'U2', '2026-10-03', 'Dr B'),
    consult(6, 'U2', '2026-10-10', 'Dr A'),
    consult(7, 'U2', '2026-10-20', 'Dr C'),
    consult(8, 'U3', null, 'Dr D'),
    consult(9, 'U3', null, 'Dr E'),
    consult(10, null, '2026-10-01', 'Dr F'), // no UMR: cannot be used
  ]);

  it('one consultation: that doctor, Matched (whatever the bill date)', () => {
    expect(index.lookup('U1', '2026-10-30')).toEqual({ status: 'Matched', method: 'single-consultation', doctor: 'Dr A', department: 'CARDIO' });
    expect(index.lookup('U1', null).status).toBe('Matched');
  });

  it('several consultations: the latest on or before the bill date', () => {
    expect(index.lookup('U2', '2026-10-15')).toMatchObject({ status: 'Fallback', doctor: 'Dr A', method: 'latest-consultation-before-bill' });
    expect(index.lookup('U2', '2026-10-20')).toMatchObject({ doctor: 'Dr C' }); // on the day counts
    expect(index.lookup('U2', '2026-10-03')).toMatchObject({ doctor: 'Dr B' });
  });

  it('several consultations, all after the bill: the earliest after', () => {
    expect(index.lookup('U2', '2026-10-01')).toMatchObject({ status: 'Fallback', doctor: 'Dr B', method: 'earliest-consultation-after-bill' });
  });

  it('several consultations with no usable dates: the first one, still a Fallback', () => {
    expect(index.lookup('U3', '2026-10-05')).toMatchObject({ status: 'Fallback', doctor: 'Dr D', method: 'first-consultation-no-date' });
    expect(index.lookup('U2', null)).toMatchObject({ status: 'Fallback', doctor: 'Dr B', method: 'first-consultation-no-bill-date' });
  });

  it('no consultation, or no UMRNO: Unattributed', () => {
    expect(index.lookup('U9', '2026-10-05')).toBe(UNATTRIBUTED);
    expect(index.lookup(null, '2026-10-05')).toBe(UNATTRIBUTED);
  });
});

const fact = (measure: FactRow['measure'], amountPaise: number, over: Partial<FactRow> = {}): FactRow => ({
  month: '2026-10',
  measure,
  amountPaise,
  doctorId: 'a',
  departmentId: 'CARDIO',
  sponsor: 'GENERAL',
  sourceId: 'opBilling',
  sourceFile: 'f.xlsx',
  sourceRow: 4,
  ref: 'B1',
  umrno: null,
  txnDate: '2026-10-02',
  ...over,
});

const doctors: DoctorMaster[] = [
  { id: 'a', displayName: 'A', department: 'Cardio', aliases: [] },
  { id: 'b', displayName: 'B', department: 'Cardio', aliases: [] },
  { id: 'c', displayName: 'C', department: 'Urology', aliases: [] },
];

describe('pivot', () => {
  const facts = [
    fact('IP_REVENUE', 100000),
    fact('OP_REVENUE', 50000),
    fact('OP_PHARMACY', 20000),
    fact('OP_PHARMACY_COST', 12000),
    fact('IP_PHARMACY_COST', 3000),
    fact('IP_COUNT', 1),
    fact('IP_COUNT', 1),
    fact('OP_REVENUE', 7000, { doctorId: 'b', departmentId: 'CARDIO', sponsor: 'STAR' }),
    fact('OP_REVENUE', 900, { doctorId: null, departmentId: null, sponsor: null }),
  ];
  const costs: CostEntry[] = [
    { doctorId: 'a', amounts: { DEPT_ISSUES: 1000, SALARY: 5000, INCENTIVES: 500, PROF_FEE: 2500 } },
    { doctorId: 'c', amounts: { SALARY: 4000 } }, // no activity, only costs
  ];

  it('computes Total Revenue and Gross Profit from the sums, with doctor costs', () => {
    const rows = pivot(facts, 'doctor', { costs });
    const a = rows.find((r) => r.key === 'a')?.values;
    expect(a).toMatchObject({ IP_COUNT: 2, TOTAL_REVENUE: 170000, SALARY: 5000 });
    // 170000 - OP pharmacy cost 12000 - IP pharmacy cost 3000 - 1000 - 5000 - 500 - 2500
    expect(a?.GROSS_PROFIT).toBe(170000 - 12000 - 3000 - 1000 - 5000 - 500 - 2500);
  });

  it('gives unmatched doctors their own row, and a doctor with only costs a row', () => {
    const keys = pivot(facts, 'doctor', { costs }).map((r) => r.key);
    expect(keys).toEqual(['a', 'b', 'c', UNMATCHED_KEY]);
    expect(pivot(facts, 'doctor', { costs }).find((r) => r.key === 'c')?.values.GROSS_PROFIT).toBe(-4000);
  });

  it('groups by department, moving doctor costs to the doctor\'s department', () => {
    const rows = pivot(facts, 'department', { costs, doctors });
    expect(rows.map((r) => r.key)).toEqual(['CARDIO', 'UROLOGY', NONE_KEY]);
    expect(rows.find((r) => r.key === 'UROLOGY')?.values.SALARY).toBe(4000);
    expect(rows.find((r) => r.key === 'CARDIO')?.values.SALARY).toBe(5000);
  });

  it('groups by sponsor with no costs, so Gross Profit is Total Revenue - pharmacy costs', () => {
    const rows = pivot(facts, 'sponsor', { costs });
    const general = rows.find((r) => r.key === 'GENERAL')?.values;
    expect(general?.SALARY).toBe(0);
    expect(general?.GROSS_PROFIT).toBe(170000 - 12000 - 3000);
    expect(rows.find((r) => r.key === 'STAR')?.values.TOTAL_REVENUE).toBe(7000);
    expect(rows.some((r) => r.key === NONE_KEY)).toBe(true);
  });

  it('groups by month, adding that month\'s costs', () => {
    const rows = pivot(facts, 'month', { costs, costMonth: '2026-10' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.values.SALARY).toBe(9000);
  });

  it('totals add up to the sum of the facts and costs', () => {
    const rows = pivot(facts, 'doctor', { costs });
    const total = totalValues(rows);
    expect(total.OP_REVENUE).toBe(50000 + 7000 + 900);
    expect(total.TOTAL_REVENUE).toBe(total.IP_REVENUE + total.OP_REVENUE + total.OP_PHARMACY);
    expect(sumFacts(facts).OP_REVENUE).toBe(57900);
    // The grand total of Gross Profit equals the sum of the rows' Gross Profit.
    expect(total.GROSS_PROFIT).toBe(rows.reduce((n, r) => n + r.values.GROSS_PROFIT, 0));
  });

  it('never loses a paisa to float addition', () => {
    const many = Array.from({ length: 1000 }, () => fact('OP_REVENUE', 10)); // 1000 x Rs 0.10
    expect(pivot(many, 'doctor')[0]?.values.OP_REVENUE).toBe(10000);
  });

  it('refuses a fraction of a paisa', () => {
    expect(() => pivot([fact('OP_REVENUE', 0.5)], 'doctor')).toThrow(/safe integer/);
  });
});
