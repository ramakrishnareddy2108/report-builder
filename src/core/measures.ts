// DRR measure registry — the single definition used everywhere.
//
// Headers match the templates exactly (including "Ip Pharmacy Cost").
// Calc measures are defined here, not in rules.json, because they mirror the
// template formulas (DRR: I = F+G+H, Q = I-J-L-M-N-O-P;
// Sponsor-wise: H = E+F+G, L = H-I-K).

import { MEASURE_CODES, type MeasureCode } from './types';

export type MeasureKind = 'money' | 'count' | 'calc';

/** Where a measure's numbers come from. */
export type MeasureOrigin = 'source' | 'costs' | 'calc';

export type CalcDefinition = {
  plus: readonly MeasureCode[];
  minus: readonly MeasureCode[];
};

export type MeasureDef = {
  code: MeasureCode;
  label: string;
  kind: MeasureKind;
  origin: MeasureOrigin;
  drrHeader: string;
  /** null when the Sponsor-wise report has no such column. */
  sponsorHeader: string | null;
  calc?: CalcDefinition;
};

const DEFS: readonly MeasureDef[] = [
  { code: 'IP_COUNT', label: 'IP Count', kind: 'count', origin: 'source', drrHeader: 'IP Count', sponsorHeader: 'IP Count' },
  { code: 'IP_REVENUE', label: 'IP Revenue', kind: 'money', origin: 'source', drrHeader: 'IP Revenue', sponsorHeader: 'IP Revenue' },
  { code: 'OP_REVENUE', label: 'OP Revenue', kind: 'money', origin: 'source', drrHeader: 'OP Revenue', sponsorHeader: 'OP Revenue' },
  { code: 'OP_PHARMACY', label: 'OP Pharmacy', kind: 'money', origin: 'source', drrHeader: 'OP Pharmacy', sponsorHeader: 'OP Pharmacy' },
  {
    code: 'TOTAL_REVENUE',
    label: 'Total Revenue',
    kind: 'calc',
    origin: 'calc',
    drrHeader: 'Total Revenue',
    sponsorHeader: 'Total Revenue',
    calc: { plus: ['IP_REVENUE', 'OP_REVENUE', 'OP_PHARMACY'], minus: [] },
  },
  { code: 'OP_PHARMACY_COST', label: 'OP Pharmacy Cost', kind: 'money', origin: 'source', drrHeader: 'OP Pharmacy Cost', sponsorHeader: 'OP Pharmacy Cost' },
  { code: 'IP_PHARMACY_NET', label: 'IP Pharmacy Revenue Net', kind: 'money', origin: 'source', drrHeader: 'IP Pharmacy revenue Net', sponsorHeader: 'IP Pharmacy revenue Net' },
  { code: 'IP_PHARMACY_COST', label: 'IP Pharmacy Cost', kind: 'money', origin: 'source', drrHeader: 'Ip Pharmacy Cost', sponsorHeader: 'Ip Pharmacy Cost' },
  { code: 'DEPT_ISSUES', label: 'Departmental Issues Cost', kind: 'money', origin: 'costs', drrHeader: 'Departmental Issues Cost', sponsorHeader: null },
  { code: 'SALARY', label: 'Salary Cost', kind: 'money', origin: 'costs', drrHeader: 'Salary Cost', sponsorHeader: null },
  { code: 'INCENTIVES', label: 'Incentives', kind: 'money', origin: 'costs', drrHeader: 'Incentives', sponsorHeader: null },
  { code: 'PROF_FEE', label: 'Professional Fee', kind: 'money', origin: 'costs', drrHeader: 'Professional Fee', sponsorHeader: null },
  {
    code: 'GROSS_PROFIT',
    label: 'Gross Profit',
    kind: 'calc',
    origin: 'calc',
    drrHeader: 'Gross Profit',
    sponsorHeader: 'Gross Profit',
    calc: {
      plus: ['TOTAL_REVENUE'],
      minus: ['OP_PHARMACY_COST', 'IP_PHARMACY_COST', 'DEPT_ISSUES', 'SALARY', 'INCENTIVES', 'PROF_FEE'],
    },
  },
];

/** All measures in DRR column order. */
export const MEASURES: readonly MeasureDef[] = DEFS;

export const MEASURE_BY_CODE: Readonly<Record<MeasureCode, MeasureDef>> = Object.fromEntries(
  DEFS.map((d) => [d.code, d]),
) as Record<MeasureCode, MeasureDef>;

export function getMeasure(code: MeasureCode): MeasureDef {
  return MEASURE_BY_CODE[code];
}

export function isMeasureCode(value: string): value is MeasureCode {
  return (MEASURE_CODES as readonly string[]).includes(value);
}

/** Full DRR header row (template row 4, columns A–Q). */
export const DRR_HEADERS: readonly string[] = [
  'S.No.',
  'Doctor Name',
  'Department',
  'Month',
  ...DEFS.map((d) => d.drrHeader),
];

/** Full Sponsor-wise header row (template row 4, columns A–L). */
export const SPONSOR_HEADERS: readonly string[] = [
  'S.No.',
  'Sponsor Name',
  'Month',
  ...DEFS.flatMap((d) => (d.sponsorHeader === null ? [] : [d.sponsorHeader])),
];

export type ReportKind = 'drr' | 'sponsor';

/** Measures that appear as a column in the given report. */
export function measuresFor(report: ReportKind): readonly MeasureDef[] {
  return report === 'drr' ? DEFS : DEFS.filter((d) => d.sponsorHeader !== null);
}

/**
 * Computes a measure from per-measure totals (integer paise, or counts).
 * Calc measures are resolved recursively; missing inputs count as 0, so at
 * sponsor level (where costs do not exist) Gross Profit = H − I − K.
 */
export function computeMeasure(
  code: MeasureCode,
  inputs: Partial<Record<MeasureCode, number>>,
): number {
  const def = MEASURE_BY_CODE[code];
  if (!def.calc) return inputs[code] ?? 0;
  let total = 0;
  for (const c of def.calc.plus) total += computeMeasure(c, inputs);
  for (const c of def.calc.minus) total -= computeMeasure(c, inputs);
  if (!Number.isSafeInteger(total)) {
    throw new TypeError(`computeMeasure(${code}): result is not a safe integer`);
  }
  return total === 0 ? 0 : total;
}

/** Human-readable formula, e.g. "IP_REVENUE + OP_REVENUE + OP_PHARMACY". */
export function calcFormulaText(code: MeasureCode): string | null {
  const calc = MEASURE_BY_CODE[code].calc;
  if (!calc) return null;
  return [calc.plus.join(' + '), ...calc.minus.map((c) => `- ${c}`)].join(' ');
}
