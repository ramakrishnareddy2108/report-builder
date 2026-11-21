import { describe, expect, it } from 'vitest';
import { loadDefaultRules } from '@/core/defaults';
import rulesDefaultJson from '@/core/defaults/rules.default.json';
import {
  ChecksFileSchema,
  CostsDefaultsFileSchema,
  CostsFileSchema,
  DashboardsFileSchema,
  DoctorsFileSchema,
  FactRowSchema,
  FactsFileSchema,
  MonthSchema,
  RulesFileSchema,
  RunInfoSchema,
  SettingsUsedFileSchema,
  SourcesFileSchema,
} from '@/core/schemas';
import type { FactRow } from '@/core/types';

const clone = <T>(v: T): T => structuredClone(v);
const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.error?.issues.map((i) => i.message) ?? [];

const SHA = 'a'.repeat(64);

const validSources = {
  version: 1,
  sources: [
    {
      sourceId: 'ipBillBreakups',
      sheet: 'Sheet1',
      headerRow: 3,
      namePattern: 'IP Bill Breakups',
      fields: {
        ref: { type: 'column', value: 'BILLNO' },
        txnDate: { type: 'column', value: 'ADMISSIONDT', occurrence: 2 },
        sponsor: { type: 'column', value: 'AH', by: 'letter' },
        pharmacyAmount: { type: 'formula', value: '[PHARMACY]' },
        status: { type: 'fixed', value: 'A' },
        concession: { type: 'none', value: null },
      },
      rowFilter: null,
      refUnique: true,
    },
    {
      sourceId: 'opPharmacySales',
      sheet: 'OP pharmacy sales data',
      headerRow: 3,
      namePattern: 'gst op pharmacy sales',
      fields: {},
      rowFilter: '[STATUS] = "A"',
      refUnique: false,
    },
  ],
};

const validDoctors = {
  version: 1,
  doctors: [
    { id: 'd1', displayName: 'Dr. A Rao', department: 'Ortho', aliases: ['DR A RAO', ' dr. a rao'] },
    { id: 'd2', displayName: 'Dr. B Shah', department: null, aliases: [] },
  ],
};

const validFact: FactRow = {
  month: '2026-10',
  measure: 'OP_PHARMACY',
  amountPaise: -12345,
  doctorId: 'd1',
  departmentId: 'ortho',
  sponsor: 'SELF',
  sourceId: 'opReturns',
  sourceFile: 'op returns report.xlsx',
  sourceRow: 4,
  ref: 'R001',
  umrno: 'UMR1',
  txnDate: '2026-10-02',
  attributionMethod: 'single consultation',
  attributionStatus: 'Matched',
};

const validRunInfo = {
  version: 1,
  month: '2026-10',
  runNumber: 1,
  status: 'Draft',
  createdAt: '2026-11-21T10:15:00+05:30',
  operatorName: 'Finance user',
  reason: null,
  files: [{ sourceId: 'opBilling', fileName: 'OP Billing Report.xlsx', sizeBytes: 1024, sha256: SHA }],
};

const validCosts = {
  version: 1,
  month: '2026-10',
  operatorName: 'Finance user',
  updatedAt: '2026-11-21T04:45:00Z',
  entries: [{ doctorId: 'd1', amounts: { SALARY: 5000000, PROF_FEE: 0 }, note: 'from HR' }],
};

const validChecks = {
  version: 1,
  month: '2026-10',
  runNumber: 1,
  checks: [
    {
      id: 'unknown-doctor',
      level: 'Warning',
      title: 'Unknown doctor names',
      message: '2 rows have a doctor name that is not in the master.',
      rows: 2,
      amountPaise: 150000,
      examples: [{ sourceFile: 'OP Billing Report.xlsx', sourceRow: 17, ref: 'B1' }],
      note: 'New doctor joined',
    },
    { id: 'source-total', level: 'Pass', title: 'Source totals', message: 'All tie out.', examples: [] },
  ],
};

describe('MonthSchema', () => {
  it.each(['2026-10', '2026-01', '1999-12'])('accepts %s', (m) => {
    expect(MonthSchema.safeParse(m).success).toBe(true);
  });
  it.each(['2026-13', '2026-00', '2026-1', '26-10', '2026/10', ''])('rejects %j', (m) => {
    expect(MonthSchema.safeParse(m).success).toBe(false);
  });
});

describe('SourcesFileSchema', () => {
  it('accepts a valid file', () => {
    expect(SourcesFileSchema.safeParse(validSources).success).toBe(true);
  });

  it('rejects a missing or wrong version', () => {
    const { version: _, ...noVersion } = validSources;
    expect(SourcesFileSchema.safeParse(noVersion).success).toBe(false);
    expect(SourcesFileSchema.safeParse({ ...validSources, version: 2 }).success).toBe(false);
  });

  it('rejects an unknown source id, field key or mapping type', () => {
    const a = clone(validSources) as { sources: Record<string, unknown>[] };
    a.sources[0]!.sourceId = 'labBilling';
    expect(SourcesFileSchema.safeParse(a).success).toBe(false);

    const b = clone(validSources) as { sources: { fields: Record<string, unknown> }[] };
    b.sources[0]!.fields.patientName = { type: 'column', value: 'PATIENTNAME' };
    expect(SourcesFileSchema.safeParse(b).success).toBe(false);

    const c = clone(validSources) as { sources: { fields: Record<string, unknown> }[] };
    c.sources[0]!.fields.ref = { type: 'lookup', value: 'X' };
    expect(SourcesFileSchema.safeParse(c).success).toBe(false);
  });

  it('rejects bad header rows and empty column names', () => {
    const a = clone(validSources) as { sources: Record<string, unknown>[] };
    a.sources[0]!.headerRow = 0;
    expect(SourcesFileSchema.safeParse(a).success).toBe(false);

    const b = clone(validSources) as { sources: { fields: Record<string, unknown> }[] };
    b.sources[0]!.fields.ref = { type: 'column', value: '  ' };
    expect(SourcesFileSchema.safeParse(b).success).toBe(false);
  });

  it('rejects the same source mapped twice', () => {
    const a = clone(validSources);
    a.sources.push(clone(validSources.sources[0]!));
    expect(messages(SourcesFileSchema.safeParse(a))).toContain('Duplicate source: ipBillBreakups');
  });
});

describe('DoctorsFileSchema', () => {
  it('accepts a valid file', () => {
    expect(DoctorsFileSchema.safeParse(validDoctors).success).toBe(true);
  });

  it('rejects duplicate ids', () => {
    const a = clone(validDoctors);
    a.doctors[1]!.id = 'd1';
    expect(messages(DoctorsFileSchema.safeParse(a))).toContain('Duplicate doctor id: d1');
  });

  it('rejects an alias owned by two doctors (case-insensitive)', () => {
    const a = clone(validDoctors);
    a.doctors[1]!.aliases = ['dr a rao'];
    expect(DoctorsFileSchema.safeParse(a).success).toBe(false);
  });

  it('rejects an empty display name', () => {
    const a = clone(validDoctors);
    a.doctors[0]!.displayName = '';
    expect(DoctorsFileSchema.safeParse(a).success).toBe(false);
  });
});

describe('RulesFileSchema', () => {
  it('accepts the shipped default rules', () => {
    const result = RulesFileSchema.safeParse(rulesDefaultJson);
    expect(messages(result)).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('loadDefaultRules returns an independent copy', () => {
    const a = loadDefaultRules();
    a.flags.includeConsultations = true;
    expect(loadDefaultRules().flags.includeConsultations).toBe(false);
  });

  it('defaults follow CLAUDE.md', () => {
    const rules = loadDefaultRules();
    const byMeasure = new Map(rules.rules.map((r) => [r.measure, r]));
    const sources = (m: string) => {
      const r = byMeasure.get(m as never);
      return r?.kind === 'source' ? r.terms.map((t) => `${t.sourceId}:${t.sign}`) : r?.kind;
    };
    expect(sources('IP_COUNT')).toEqual(['ipDischarge:1']);
    expect(sources('IP_REVENUE')).toEqual(['ipGeneralBill:1', 'ipGeneralBill:1']);
    expect(sources('OP_REVENUE')).toEqual(['opBilling:1', 'opConsultations:1']);
    expect(sources('OP_PHARMACY')).toEqual(['opPharmacySales:1', 'opReturns:-1']);
    expect(sources('OP_PHARMACY_COST')).toEqual(['opPharmacySales:1']);
    expect(sources('IP_PHARMACY_NET')).toEqual(['ipBillBreakups:1']);
    expect(sources('IP_PHARMACY_COST')).toEqual(['ipBillBreakups:1']);
    for (const m of ['DEPT_ISSUES', 'SALARY', 'INCENTIVES', 'PROF_FEE']) expect(sources(m)).toBe('costs');
    expect(byMeasure.has('TOTAL_REVENUE')).toBe(false);
    expect(byMeasure.has('GROSS_PROFIT')).toBe(false);
    expect(rules.flags.includeConsultations).toBe(false);
  });

  it('rejects a missing rule', () => {
    const a = clone(rulesDefaultJson);
    a.rules = a.rules.filter((r) => r.measure !== 'SALARY');
    expect(messages(RulesFileSchema.safeParse(a))).toContain('Missing rule for SALARY');
  });

  it('rejects two rules for one measure', () => {
    const a = clone(rulesDefaultJson);
    a.rules.push({ measure: 'SALARY', kind: 'costs' });
    expect(messages(RulesFileSchema.safeParse(a))).toContain('Duplicate rule for measure: SALARY');
  });

  it('rejects a rule for a calc measure', () => {
    const a = clone(rulesDefaultJson);
    a.rules.push({ measure: 'TOTAL_REVENUE', kind: 'costs' });
    expect(RulesFileSchema.safeParse(a).success).toBe(false);
  });

  it('rejects the wrong rule kind for a measure', () => {
    const a = clone(rulesDefaultJson) as { rules: { measure: string; kind: string }[] };
    const salary = a.rules.find((r) => r.measure === 'SALARY')!;
    Object.assign(salary, {
      kind: 'source',
      terms: [{ sourceId: 'opBilling', value: { type: 'field', field: 'netAmount' }, filter: null, sign: 1, attribution: 'sourceDoctor' }],
    });
    expect(messages(RulesFileSchema.safeParse(a))).toContain('SALARY must be a "costs" rule, not "source"');
  });

  it('rejects count/money value mismatches', () => {
    const a = clone(rulesDefaultJson) as { rules: { measure: string; terms?: { value: unknown }[] }[] };
    a.rules.find((r) => r.measure === 'IP_COUNT')!.terms![0]!.value = { type: 'field', field: 'netAmount' };
    expect(RulesFileSchema.safeParse(a).success).toBe(false);

    const b = clone(rulesDefaultJson) as { rules: { measure: string; terms?: { value: unknown }[] }[] };
    b.rules.find((r) => r.measure === 'OP_REVENUE')!.terms![0]!.value = { type: 'count' };
    expect(RulesFileSchema.safeParse(b).success).toBe(false);
  });

  it('rejects bad signs, unknown fields and empty term lists', () => {
    const a = clone(rulesDefaultJson) as { rules: { measure: string; terms?: Record<string, unknown>[] }[] };
    a.rules.find((r) => r.measure === 'OP_PHARMACY')!.terms![1]!.sign = -2;
    expect(RulesFileSchema.safeParse(a).success).toBe(false);

    const b = clone(rulesDefaultJson) as { rules: { measure: string; terms?: Record<string, unknown>[] }[] };
    b.rules.find((r) => r.measure === 'OP_REVENUE')!.terms![0]!.value = { type: 'field', field: 'NETAMOUNT' };
    expect(RulesFileSchema.safeParse(b).success).toBe(false);

    const c = clone(rulesDefaultJson) as { rules: { measure: string; terms?: unknown[] }[] };
    c.rules.find((r) => r.measure === 'OP_REVENUE')!.terms = [];
    expect(RulesFileSchema.safeParse(c).success).toBe(false);
  });

  it('rejects missing flags', () => {
    const a = clone(rulesDefaultJson) as { flags: Record<string, unknown> };
    delete a.flags.includeConsultations;
    expect(RulesFileSchema.safeParse(a).success).toBe(false);
  });
});

describe('CostsFileSchema / CostsDefaultsFileSchema', () => {
  it('accepts valid files', () => {
    expect(CostsFileSchema.safeParse(validCosts).success).toBe(true);
    expect(CostsDefaultsFileSchema.safeParse({ version: 1, entries: validCosts.entries }).success).toBe(true);
  });

  it('rejects non-integer paise, unknown cost measures and duplicate doctors', () => {
    const a = clone(validCosts) as { entries: { amounts: Record<string, unknown> }[] };
    a.entries[0]!.amounts.SALARY = 50000.5;
    expect(CostsFileSchema.safeParse(a).success).toBe(false);

    const b = clone(validCosts) as { entries: { amounts: Record<string, unknown> }[] };
    b.entries[0]!.amounts.IP_REVENUE = 100;
    expect(CostsFileSchema.safeParse(b).success).toBe(false);

    const c = clone(validCosts);
    c.entries.push(clone(validCosts.entries[0]!));
    expect(messages(CostsFileSchema.safeParse(c))).toContain('Duplicate doctor: d1');
  });

  it('rejects a bad month or timestamp', () => {
    expect(CostsFileSchema.safeParse({ ...validCosts, month: 'Oct 2026' }).success).toBe(false);
    expect(CostsFileSchema.safeParse({ ...validCosts, updatedAt: 'yesterday' }).success).toBe(false);
  });
});

describe('FactRowSchema / FactsFileSchema', () => {
  it('accepts a valid fact and facts file', () => {
    expect(FactRowSchema.safeParse(validFact).success).toBe(true);
    const minimal = { ...validFact, doctorId: null, departmentId: null, sponsor: null, ref: null, umrno: null, txnDate: null };
    delete (minimal as Partial<FactRow>).attributionMethod;
    delete (minimal as Partial<FactRow>).attributionStatus;
    expect(FactRowSchema.safeParse(minimal).success).toBe(true);
    expect(FactsFileSchema.safeParse({ version: 1, month: '2026-10', runNumber: 1, facts: [validFact] }).success).toBe(true);
  });

  it('rejects extra keys such as patient names', () => {
    expect(FactRowSchema.safeParse({ ...validFact, patientName: 'X' }).success).toBe(false);
  });

  it('rejects float amounts, bad dates and bad statuses', () => {
    expect(FactRowSchema.safeParse({ ...validFact, amountPaise: 123.4 }).success).toBe(false);
    expect(FactRowSchema.safeParse({ ...validFact, txnDate: '02-OCT-2026' }).success).toBe(false);
    expect(FactRowSchema.safeParse({ ...validFact, txnDate: '2026-02-30' }).success).toBe(false);
    expect(FactRowSchema.safeParse({ ...validFact, attributionStatus: 'Guessed' }).success).toBe(false);
    expect(FactRowSchema.safeParse({ ...validFact, sourceRow: 0 }).success).toBe(false);
  });

  it('rejects calc and cost measures as facts', () => {
    expect(FactRowSchema.safeParse({ ...validFact, measure: 'TOTAL_REVENUE' }).success).toBe(false);
    expect(FactRowSchema.safeParse({ ...validFact, measure: 'SALARY' }).success).toBe(false);
  });
});

describe('ChecksFileSchema', () => {
  it('accepts a valid file', () => {
    expect(ChecksFileSchema.safeParse(validChecks).success).toBe(true);
  });

  it('rejects an unknown level or negative row count', () => {
    const a = clone(validChecks);
    a.checks[0]!.level = 'Info';
    expect(ChecksFileSchema.safeParse(a).success).toBe(false);

    const b = clone(validChecks);
    b.checks[0]!.rows = -1;
    expect(ChecksFileSchema.safeParse(b).success).toBe(false);
  });
});

describe('RunInfoSchema', () => {
  it('accepts a Draft and a Final run', () => {
    expect(RunInfoSchema.safeParse(validRunInfo).success).toBe(true);
    expect(
      RunInfoSchema.safeParse({ ...validRunInfo, status: 'Final', finalizedAt: '2026-11-22T09:00:00Z' }).success,
    ).toBe(true);
  });

  it('rejects a Final run without finalizedAt', () => {
    expect(messages(RunInfoSchema.safeParse({ ...validRunInfo, status: 'Final' }))).toContain(
      'A Final run needs finalizedAt',
    );
  });

  it('rejects bad fingerprints, statuses and run numbers', () => {
    const a = clone(validRunInfo);
    a.files[0]!.sha256 = 'ABC';
    expect(RunInfoSchema.safeParse(a).success).toBe(false);
    expect(RunInfoSchema.safeParse({ ...validRunInfo, status: 'Locked' }).success).toBe(false);
    expect(RunInfoSchema.safeParse({ ...validRunInfo, runNumber: 0 }).success).toBe(false);
  });
});

describe('SettingsUsedFileSchema', () => {
  it('accepts a full snapshot', () => {
    const result = SettingsUsedFileSchema.safeParse({
      version: 1,
      sources: validSources,
      doctors: validDoctors,
      rules: rulesDefaultJson,
      costsDefaults: null,
    });
    expect(messages(result)).toEqual([]);
  });

  it('rejects a snapshot with invalid rules', () => {
    const rules = clone(rulesDefaultJson);
    rules.rules = [];
    expect(
      SettingsUsedFileSchema.safeParse({ version: 1, sources: validSources, doctors: validDoctors, rules, costsDefaults: null })
        .success,
    ).toBe(false);
  });
});

describe('DashboardsFileSchema (placeholder)', () => {
  it('accepts dashboards with an id and name and keeps other keys', () => {
    const parsed = DashboardsFileSchema.parse({
      version: 1,
      dashboards: [{ id: 'x', name: 'Monthly Review', tiles: [] }],
    });
    expect(parsed.dashboards[0]).toHaveProperty('tiles');
  });

  it('rejects a dashboard without a name', () => {
    expect(DashboardsFileSchema.safeParse({ version: 1, dashboards: [{ id: 'x' }] }).success).toBe(false);
  });
});
