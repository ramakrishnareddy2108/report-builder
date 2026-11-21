import { beforeAll, describe, expect, it } from 'vitest';
import { countByLevel, finalBlockers, runChecks, withNotes, type CheckInput } from '@/core/checks';
import { RulesFileSchema } from '@/core/schemas';
import type { RunOutput } from '@/core/runMonth';
import type { CheckResult, CostEntry, FactRow } from '@/core/types';
import { runMonthTask } from '@/worker/tasks/runMonth';
import { DR_A, DOCTORS, MONTH, monthRequest, monthSettings } from '../helpers/monthFixture';

const SOME_COSTS: CostEntry[] = [{ doctorId: DR_A, amounts: { SALARY: 500000 } }];
let run: RunOutput;
beforeAll(async () => {
  run = await runMonthTask(monthRequest());
});

function input(over: Partial<CheckInput> = {}, diag = run.diagnostics): CheckInput {
  return { month: MONTH, rules: monthSettings().rules, doctors: DOCTORS, diagnostics: diag, facts: run.facts, costs: SOME_COSTS, previous: null, ...over };
}
const find = (checks: CheckResult[], id: string): CheckResult => {
  const c = checks.find((x) => x.id === id);
  if (!c) throw new Error(`No check ${id}`);
  return c;
};
const levels = (checks: CheckResult[]) => Object.fromEntries(checks.map((c) => [c.id, c.level]));
/** A copy of the diagnostics to break in a test. */
const copy = () => structuredClone(run.diagnostics);

describe('the made-up month', () => {
  it('gives the expected level for every check', () => {
    expect(levels(runChecks(input()))).toEqual({
      'sources-present': 'Pass',
      'sources-fit-mapping': 'Pass',
      'rule-formulas': 'Pass',
      'unreadable-amounts': 'Fail', // G3 has an unreadable gross amount
      'row-filter-errors': 'Pass',
      'duplicate-files': 'Pass',
      'duplicate-refs': 'Pass',
      'source-totals': 'Pass',
      'report-ties-to-sources': 'Pass',
      'unknown-doctors': 'Warning', // "Dr Unknown"
      'costs-entered': 'Pass',
      'costs-unknown-doctors': 'Pass',
      'pharmacy-attribution': 'Warning', // 2 Fallback + 1 Unattributed
      'op-overlap': 'Pass', // consultations are not added to OP revenue
      'dates-outside-month': 'Warning', // G4 is dated in November
      'rows-without-number': 'Pass', // each file has at most its one total row
      'unreadable-other-cells': 'Pass',
      'change-vs-previous': 'Pass', // no previous Final month
      'ip-via-op-pharmacy': 'Pass',
      'rows-not-used': 'Pass',
    });
  });

  it('every check has a title and a plain message, and no check says nothing', () => {
    for (const c of runChecks(input())) {
      expect(c.title.length).toBeGreaterThan(3);
      expect(c.message.length).toBeGreaterThan(10);
    }
  });

  it('points at the unreadable amount with its file, row and bill number', () => {
    const c = find(runChecks(input()), 'unreadable-amounts');
    expect(c.rows).toBe(1);
    expect(c.examples).toEqual([{ sourceFile: 'IP General Bill Breakup Oct2026.xlsx', sourceRow: 6, ref: 'G3' }]);
    expect(c.message).toMatch(/cannot be read.*left out/);
  });

  it('counts pharmacy attribution rows and amounts', () => {
    const c = find(runChecks(input()), 'pharmacy-attribution');
    expect(c.rows).toBe(3);
    expect(c.details).toEqual([
      'Matched: 3 rows, ₹70.00', // S1 100 + S1 0 + R1 -30
      'Fallback: 2 rows, ₹250.00',
      'Unattributed: 1 row, ₹70.30',
    ]);
  });

  it('lists the unknown doctor by name with where it was seen', () => {
    const c = find(runChecks(input()), 'unknown-doctors');
    expect(c.rows).toBe(1);
    expect(c.details).toEqual(['Dr Unknown: 1 row in IP Discharge']);
  });

  it('reports in-patients at the OP counter as information, with the numbers', () => {
    const c = find(runChecks(input()), 'ip-via-op-pharmacy');
    expect(c.level).toBe('Pass');
    expect(c.rows).toBe(2);
    expect(c.amountPaise).toBe(50000 - 8000);
  });

  it('accounts for the rows that were not used, with the reason', () => {
    const c = find(runChecks(input()), 'rows-not-used');
    expect(c.details?.some((d) => /IP Discharge: 1 row skipped.*grand-total/.test(d))).toBe(true);
    expect(c.details?.some((d) => /IP_REVENUE from IP General Bill Breakup: \d+ rows? left out by the rule/.test(d))).toBe(true);
  });
});

describe('Fail checks', () => {
  it('a needed source with no file', () => {
    const d = copy();
    Object.assign(d.sources.find((s) => s.sourceId === 'opReturns')!, { status: 'missing', fileName: null });
    const c = find(runChecks(input({}, d)), 'sources-present');
    expect(c).toMatchObject({ level: 'Fail', details: ['OP Returns'] });
  });

  it('a source whose file no longer fits its mapping lists the missing column', () => {
    const d = copy();
    Object.assign(d.sources.find((s) => s.sourceId === 'opBilling')!, {
      status: 'flagged',
      problems: [{ field: 'netAmount', message: '“NETAMOUNT” was not found in this file (needed for netAmount).', missingColumns: ['NETAMOUNT'] }],
    });
    const c = find(runChecks(input({}, d)), 'sources-fit-mapping');
    expect(c.level).toBe('Fail');
    expect(c.details?.[0]).toMatch(/OP Billing: “NETAMOUNT” was not found/);
  });

  it('the same file loaded twice, from the run or from the Run page', () => {
    const d = copy();
    d.duplicateFiles = [{ sha256: 'a'.repeat(64), fileNames: ['x.xlsx', 'y.xlsx'], sourceIds: ['opBilling', 'opReturns'] }];
    expect(find(runChecks(input({}, d)), 'duplicate-files').level).toBe('Fail');
    const viaPage = runChecks(input({ duplicateLoadedFiles: d.duplicateFiles }));
    expect(find(viaPage, 'duplicate-files')).toMatchObject({ level: 'Fail', message: expect.stringContaining('“x.xlsx” and “y.xlsx”') });
  });

  it('a bill number that appears twice where it should be unique', () => {
    const d = copy();
    Object.assign(d.sources.find((s) => s.sourceId === 'opBilling')!, {
      duplicateRefs: { rows: 2, examples: [{ ref: 'B1', rows: [4, 9] }] },
    });
    const c = find(runChecks(input({}, d)), 'duplicate-refs');
    expect(c).toMatchObject({ level: 'Fail', rows: 2 });
    expect(c.details?.[0]).toMatch(/OP Billing: 2 rows.*B1 on rows 4 and 9/);
  });

  it('a file whose own total differs from its rows by more than one rupee', () => {
    const d = copy();
    const s = d.sources.find((x) => x.sourceId === 'opBilling')!;
    s.footerTotals.netAmount = (s.fieldTotals.netAmount ?? 0) + 150; // Rs 1.50 apart
    const c = find(runChecks(input({}, d)), 'source-totals');
    expect(c.level).toBe('Fail');
    expect(c.details?.[0]).toMatch(/OP Billing netAmount: the file says ₹652\.00, its rows add up to ₹650\.50/);
  });

  it('allows a difference of one rupee or less', () => {
    const d = copy();
    const s = d.sources.find((x) => x.sourceId === 'opBilling')!;
    s.footerTotals.netAmount = (s.fieldTotals.netAmount ?? 0) + 100;
    expect(find(runChecks(input({}, d)), 'source-totals').level).toBe('Pass');
  });

  it('a report total that does not tie to the source total', () => {
    const facts: FactRow[] = run.facts.map((f) => ({ ...f }));
    const i = facts.findIndex((f) => f.measure === 'OP_REVENUE');
    facts[i] = { ...facts[i]!, amountPaise: facts[i]!.amountPaise + 500 };
    const c = find(runChecks(input({ facts })), 'report-ties-to-sources');
    expect(c.level).toBe('Fail');
    expect(c.details?.[0]).toMatch(/OP_REVENUE: sources gave .*, the report has/);
  });

  it('a row filter that could not be evaluated, from the mapping or from a rule', () => {
    const d = copy();
    d.sources.find((s) => s.sourceId === 'opBilling')!.skipped.filterError = { count: 2, examples: [{ sourceFile: 'f.xlsx', sourceRow: 9, ref: 'B9' }] };
    const c = find(runChecks(input({}, d)), 'row-filter-errors');
    expect(c).toMatchObject({ level: 'Fail', rows: 2 });
  });

  it('a rule formula that cannot be read', () => {
    const d = copy();
    d.ruleProblems = ['IP_REVENUE: the value formula is not a valid formula: Expected a value'];
    expect(find(runChecks(input({}, d)), 'rule-formulas')).toMatchObject({ level: 'Fail', details: d.ruleProblems });
  });
});

describe('Warning checks', () => {
  it('warns when a file has more than its one total row without a number', () => {
    const d = copy();
    d.sources.find((s) => s.sourceId === 'opBilling')!.skipped.noReference = { count: 3, examples: [{ sourceFile: 'OP.xlsx', sourceRow: 9, ref: null }] };
    const c = find(runChecks(input({}, d)), 'rows-without-number');
    expect(c).toMatchObject({ level: 'Warning', rows: 3 });
    expect(c.details).toEqual(['OP Billing: 3 rows']);
  });

  it('lists the rule terms that are switched off, so their rows are not forgotten', () => {
    const c = find(runChecks(input()), 'rows-not-used');
    expect(c.details?.some((l) => /OP_REVENUE from OP Consultations: switched off \(includeConsultations is off\)/.test(l))).toBe(true);
    expect(c.message).toMatch(/1 rule term is switched off/);
    const on = monthSettings({ flags: { includeConsultations: true } }).rules;
    expect(find(runChecks(input({ rules: on })), 'rows-not-used').details?.some((l) => /switched off/.test(l))).toBe(false);
  });

  it('warns when no costs were entered, and when costs belong to doctors who left the list', () => {
    expect(find(runChecks(input({ costs: [] })), 'costs-entered')).toMatchObject({ level: 'Warning' });
    expect(find(runChecks(input({ costs: [{ doctorId: DR_A, amounts: {} }] })), 'costs-entered').level).toBe('Warning'); // a note alone is not a cost
    expect(find(runChecks(input({ costs: [{ doctorId: DR_A, amounts: { SALARY: 0 } }] })), 'costs-entered').level).toBe('Pass'); // an entered 0 counts
    const orphan = find(runChecks(input({ costs: [{ doctorId: 'gone', amounts: { SALARY: 100 } }] })), 'costs-unknown-doctors');
    expect(orphan).toMatchObject({ level: 'Warning', rows: 1, details: ['gone'] });
  });

  it('overlap of OP Billing and Consultations only warns when consultations are added to OP revenue', () => {
    const on = monthSettings({ flags: { includeConsultations: true } }).rules;
    expect(find(runChecks(input({ rules: on })), 'op-overlap')).toMatchObject({ level: 'Warning', rows: 2 });
    expect(find(runChecks(input()), 'op-overlap').message).toMatch(/nothing is counted twice/);
  });

  it('rows dated outside the month are listed with their date', () => {
    const c = find(runChecks(input()), 'dates-outside-month');
    expect(c.examples).toEqual([{ sourceFile: 'IP General Bill Breakup Oct2026.xlsx', sourceRow: 7, ref: 'G4' }]);
    expect(c.details).toEqual(['IP_REVENUE from IP General Bill Breakup: 1 row outside the month']);
  });

  it('unreadable cells in columns no rule uses are warned about, not failed', () => {
    const d = copy();
    d.sources.find((s) => s.sourceId === 'ipDischarge')!.unreadableUnused = { count: 3, examples: [{ sourceFile: 'd.xlsx', sourceRow: 4, ref: 'IP1' }] };
    expect(find(runChecks(input({}, d)), 'unreadable-other-cells')).toMatchObject({ level: 'Warning', rows: 3 });
  });
});

describe('change against the previous Final month', () => {
  const rules = () => monthSettings().rules;
  const revenueFact = (doctorId: string | null, amountPaise: number, over: Partial<FactRow> = {}): FactRow => ({
    month: '2026-09', measure: 'OP_REVENUE', amountPaise, doctorId, departmentId: 'CARDIOLOGY', sponsor: 'GENERAL',
    sourceId: 'opBilling', sourceFile: 'f', sourceRow: 4, ref: null, umrno: null, txnDate: '2026-09-02', ...over,
  });
  const now = (amountPaise: number) => [revenueFact(DR_A, amountPaise, { month: MONTH })];
  const check = (nowFacts: FactRow[], before: FactRow[], r = rules()) =>
    find(runChecks(input({ facts: nowFacts, previous: { month: '2026-09', facts: before }, rules: r })), 'change-vs-previous');

  it('warns when a doctor moves by more than 50%, naming them with both amounts', () => {
    const c = check(now(900_000), [revenueFact(DR_A, 500_000)]);
    expect(c.level).toBe('Warning');
    expect(c.details).toContain('Doctor A Kumar: up 80% (₹5,000.00 in 2026-09, ₹9,000.00 in 2026-10)');
    expect(c.details?.some((d) => d.startsWith('Department CARDIOLOGY'))).toBe(true);
  });

  it('does not warn for a move of exactly the threshold or less', () => {
    expect(check(now(750_000), [revenueFact(DR_A, 500_000)]).level).toBe('Pass'); // +50%
  });

  it('warns on a fall too, and on a doctor with no revenue last month', () => {
    expect(check(now(200_000), [revenueFact(DR_A, 500_000)]).details?.[0]).toMatch(/down 60%/);
    expect(check(now(900_000), []).details?.[0]).toMatch(/new this month/);
  });

  it('ignores small amounts below the floor', () => {
    expect(check(now(9_000), [revenueFact(DR_A, 3_000)]).level).toBe('Pass'); // both under Rs 1,000
  });

  it('uses the configurable threshold', () => {
    const strict = { ...rules(), thresholds: { changePercent: 10, minChangePaise: 0 } };
    expect(check(now(560_000), [revenueFact(DR_A, 500_000)], strict).level).toBe('Warning'); // +12%
  });

  it('says so when there is nothing to compare with', () => {
    expect(find(runChecks(input()), 'change-vs-previous').message).toMatch(/no earlier Final month/);
  });
});

describe('making a run Final', () => {
  const checks = () => runChecks(input());

  it('is blocked by Fails and by Warnings without a note', () => {
    const reasons = finalBlockers(checks());
    expect(reasons).toContain('Fix: Amounts can be read');
    expect(reasons).toContain('Add a note to the warning: Every doctor name is in the doctor list');
  });

  it('is allowed with no Fail and a typed note on every Warning', () => {
    const fixed = checks().map((c): CheckResult => (c.level === 'Fail' ? { ...c, level: 'Pass' } : c));
    const warnings = fixed.filter((c) => c.level === 'Warning').map((c) => c.id);
    expect(finalBlockers(fixed)).toHaveLength(warnings.length);
    const notes = Object.fromEntries(warnings.map((id) => [id, 'Reviewed with the department head']));
    expect(finalBlockers(withNotes(fixed, notes))).toEqual([]);
  });

  it('a blank note does not count', () => {
    const fixed = checks().map((c): CheckResult => (c.level === 'Fail' ? { ...c, level: 'Pass' } : c));
    const notes = Object.fromEntries(fixed.filter((c) => c.level === 'Warning').map((c) => [c.id, '   ']));
    expect(finalBlockers(withNotes(fixed, notes)).length).toBeGreaterThan(0);
  });

  it('counts checks by level', () => {
    expect(countByLevel(checks())).toEqual({ Pass: 16, Warning: 3, Fail: 1 });
  });
});

describe('thresholds in rules.json', () => {
  it('an older rules file without thresholds still loads, with the defaults', () => {
    const settings = monthSettings();
    const { thresholds: _omit, ...older } = settings.rules;
    const parsed = RulesFileSchema.parse(older);
    expect(parsed.thresholds).toEqual({ changePercent: 50, minChangePaise: 100_000 });
  });
  it('rejects a threshold that makes no sense', () => {
    const settings = monthSettings();
    expect(RulesFileSchema.safeParse({ ...settings.rules, thresholds: { changePercent: 0, minChangePaise: 0 } }).success).toBe(false);
    expect(RulesFileSchema.safeParse({ ...settings.rules, thresholds: { changePercent: 50, minChangePaise: 1.5 } }).success).toBe(false);
  });
});
