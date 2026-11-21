import { describe, expect, it } from 'vitest';
import {
  DRR_HEADERS,
  MEASURES,
  SPONSOR_HEADERS,
  calcFormulaText,
  computeMeasure,
  measuresFor,
} from '@/core/measures';
import { MEASURE_CODES } from '@/core/types';

describe('measure registry', () => {
  it('defines every measure code exactly once', () => {
    expect(MEASURES.map((m) => m.code).sort()).toEqual([...MEASURE_CODES].sort());
  });

  it('matches the DRR template header row (A–Q)', () => {
    expect(DRR_HEADERS).toEqual([
      'S.No.', 'Doctor Name', 'Department', 'Month', 'IP Count', 'IP Revenue', 'OP Revenue',
      'OP Pharmacy', 'Total Revenue', 'OP Pharmacy Cost', 'IP Pharmacy revenue Net',
      'Ip Pharmacy Cost', 'Departmental Issues Cost', 'Salary Cost', 'Incentives',
      'Professional Fee', 'Gross Profit',
    ]);
  });

  it('matches the Sponsor-wise template header row (A–L)', () => {
    expect(SPONSOR_HEADERS).toEqual([
      'S.No.', 'Sponsor Name', 'Month', 'IP Count', 'IP Revenue', 'OP Revenue', 'OP Pharmacy',
      'Total Revenue', 'OP Pharmacy Cost', 'IP Pharmacy revenue Net', 'Ip Pharmacy Cost',
      'Gross Profit',
    ]);
    expect(measuresFor('sponsor').some((m) => m.origin === 'costs')).toBe(false);
  });

  it('only calc measures have a calc definition', () => {
    for (const m of MEASURES) expect(m.calc !== undefined).toBe(m.kind === 'calc');
  });
});

describe('computeMeasure', () => {
  const inputs = {
    IP_REVENUE: 100_00,
    OP_REVENUE: 50_00,
    OP_PHARMACY: 25_00,
    OP_PHARMACY_COST: 10_00,
    IP_PHARMACY_NET: 999_00, // not part of either formula
    IP_PHARMACY_COST: 5_00,
    DEPT_ISSUES: 1_00,
    SALARY: 2_00,
    INCENTIVES: 3_00,
    PROF_FEE: 4_00,
  };

  it('Total Revenue = F + G + H', () => {
    expect(computeMeasure('TOTAL_REVENUE', inputs)).toBe(175_00);
  });

  it('Gross Profit = I − J − L − M − N − O − P', () => {
    expect(computeMeasure('GROSS_PROFIT', inputs)).toBe(175_00 - 10_00 - 5_00 - 1_00 - 2_00 - 3_00 - 4_00);
  });

  it('sponsor-level Gross Profit (no costs) = H − I − K', () => {
    const { DEPT_ISSUES: _a, SALARY: _b, INCENTIVES: _c, PROF_FEE: _d, ...sponsorInputs } = inputs;
    expect(computeMeasure('GROSS_PROFIT', sponsorInputs)).toBe(175_00 - 10_00 - 5_00);
  });

  it('returns plain inputs and treats missing as 0', () => {
    expect(computeMeasure('IP_REVENUE', inputs)).toBe(100_00);
    expect(computeMeasure('IP_COUNT', {})).toBe(0);
    expect(computeMeasure('GROSS_PROFIT', {})).toBe(0);
  });

  it('describes calc formulas', () => {
    expect(calcFormulaText('TOTAL_REVENUE')).toBe('IP_REVENUE + OP_REVENUE + OP_PHARMACY');
    expect(calcFormulaText('GROSS_PROFIT')).toBe(
      'TOTAL_REVENUE - OP_PHARMACY_COST - IP_PHARMACY_COST - DEPT_ISSUES - SALARY - INCENTIVES - PROF_FEE',
    );
    expect(calcFormulaText('IP_COUNT')).toBeNull();
  });
});
