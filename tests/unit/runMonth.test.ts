import { describe, expect, it } from 'vitest';
import { UNMATCHED_KEY, pivot, sumFacts, totalValues } from '@/core/aggregate';
import { UNATTRIBUTED_DOCTOR_ID, type FactRow, type MeasureCode } from '@/core/types';
import type { RunOutput } from '@/core/runMonth';
import { runMonthTask } from '@/worker/tasks/runMonth';
import { MONTH_DATA } from '../helpers/monthData';
import { DR_A, DR_B, MONTH, monthRequest, monthSettings } from '../helpers/monthFixture';
import { hisFile } from '../helpers/syntheticWorkbook';

let cached: Promise<RunOutput> | null = null;
const defaultRun = () => (cached ??= runMonthTask(monthRequest()));

const factsOf = (run: RunOutput, measure: MeasureCode) => run.facts.filter((f) => f.measure === measure);
const byDoctor = (run: RunOutput, measure: MeasureCode) =>
  Object.fromEntries(pivot(run.facts, 'doctor').map((r) => [r.key, r.values[measure]]));

describe('measures from the default rules', () => {
  it('IP_COUNT is 1 per discharge row; the total row is skipped, the unknown doctor is unmatched', async () => {
    const run = await defaultRun();
    expect(byDoctor(run, 'IP_COUNT')).toMatchObject({ [DR_A]: 2, [DR_B]: 1, [UNMATCHED_KEY]: 1 });
    expect(factsOf(run, 'IP_COUNT').every((f) => f.amountPaise === 1)).toBe(true);
  });

  it('IP_REVENUE is gross - concession in exact paise; PENDING is included by default; a bad amount is left out', async () => {
    const run = await defaultRun();
    // A: G1 10000.50 - 500.25 = 9500.25 and G2 (PENDING) 2000.00
    expect(byDoctor(run, 'IP_REVENUE')[DR_A]).toBe(950025 + 200000);
    // B: G3 has an unreadable gross amount (left out and counted); G4 is 3000 - 100
    expect(byDoctor(run, 'IP_REVENUE')[DR_B]).toBe(290000);
  });

  it('excludes PENDING bills when includePendingIpBills is off', async () => {
    const run = await runMonthTask(monthRequest(monthSettings({ flags: { includePendingIpBills: false } })));
    expect(byDoctor(run, 'IP_REVENUE')[DR_A]).toBe(950025);
  });

  it('OP_REVENUE is OP Billing net amount only; consultations are added only when the flag is on', async () => {
    const run = await defaultRun();
    expect(byDoctor(run, 'OP_REVENUE')).toMatchObject({ [DR_A]: 40000, [DR_B]: 25050 });

    const withConsults = await runMonthTask(monthRequest(monthSettings({ flags: { includeConsultations: true } })));
    expect(byDoctor(withConsults, 'OP_REVENUE')).toMatchObject({ [DR_A]: 40000 + 30000 + 10000, [DR_B]: 25050 + 20000 });
  });

  it('IP pharmacy net and cost come from IP Bill Breakups', async () => {
    const run = await defaultRun();
    expect(byDoctor(run, 'IP_PHARMACY_NET')).toMatchObject({ [DR_A]: 100010, [DR_B]: 50000 });
    expect(byDoctor(run, 'IP_PHARMACY_COST')).toMatchObject({ [DR_A]: 60005, [DR_B]: 30000 });
  });

  it('OP_PHARMACY is sales minus OP returns, attributed through consultations', async () => {
    const run = await defaultRun();
    // A: S1 100 - R1 30 (Matched) + S3 50 (Fallback); B: S2 200 (Fallback); Unattributed: S4 70.30
    expect(byDoctor(run, 'OP_PHARMACY')).toEqual({ [DR_A]: 12000, [DR_B]: 20000, [UNATTRIBUTED_DOCTOR_ID]: 7030, [UNMATCHED_KEY]: 0 });
    expect(byDoctor(run, 'OP_PHARMACY_COST')).toEqual({ [DR_A]: 9000, [DR_B]: 12000, [UNATTRIBUTED_DOCTOR_ID]: 4000, [UNMATCHED_KEY]: 0 });
  });
});

describe('pharmacy attribution', () => {
  it('records the method and status on every pharmacy fact', async () => {
    const run = await defaultRun();
    const sales = factsOf(run, 'OP_PHARMACY');
    const row = (ref: string, source: string) => sales.find((f) => f.ref === ref && f.sourceId === source && f.amountPaise !== 0);

    expect(row('S1', 'opPharmacySales')).toMatchObject({ doctorId: DR_A, attributionStatus: 'Matched', attributionMethod: 'single-consultation' });
    expect(row('S2', 'opPharmacySales')).toMatchObject({ doctorId: DR_B, attributionStatus: 'Fallback', attributionMethod: 'latest-consultation-before-bill' });
    expect(row('S3', 'opPharmacySales')).toMatchObject({ doctorId: DR_A, attributionStatus: 'Fallback' });
    expect(row('S4', 'opPharmacySales')).toMatchObject({ doctorId: UNATTRIBUTED_DOCTOR_ID, attributionStatus: 'Unattributed', attributionMethod: 'no-consultation' });
    expect(row('R1', 'opReturns')).toMatchObject({ doctorId: DR_A, amountPaise: -3000, attributionStatus: 'Matched' });
    expect(sales.every((f) => f.attributionStatus !== undefined)).toBe(true);
  });

  it('counts in-patients buying at the OP counter apart, and keeps them out of OP pharmacy', async () => {
    const run = await defaultRun();
    expect(run.facts.some((f) => f.ref === 'S5' || f.ref === 'R2')).toBe(false);
    const sales = run.diagnostics.terms.find((t) => t.sourceId === 'opPharmacySales' && t.measure === 'OP_PHARMACY');
    const returns = run.diagnostics.terms.find((t) => t.sourceId === 'opReturns');
    expect(sales?.ipViaOp).toMatchObject({ count: 1, amountPaise: 50000 });
    expect(returns?.ipViaOp).toMatchObject({ count: 1, amountPaise: -8000 }); // a return reduces
  });

  it('only non-pharmacy facts have no attribution fields', async () => {
    const run = await defaultRun();
    expect(factsOf(run, 'IP_REVENUE').every((f) => f.attributionStatus === undefined && f.attributionMethod === undefined)).toBe(true);
  });
});

describe('nothing is dropped silently', () => {
  it('counts the unreadable amount with its row, and the out-of-month bill, but still uses it', async () => {
    const run = await defaultRun();
    const term = run.diagnostics.terms.filter((t) => t.measure === 'IP_REVENUE');
    const bad = term.reduce((n, t) => n + t.badAmount.count, 0);
    expect(bad).toBe(1);
    const example = term.flatMap((t) => t.badAmount.examples)[0];
    expect(example).toMatchObject({ ref: 'G3', sourceRow: 6 });
    expect(example?.detail).toMatch(/not a readable amount/);

    const outside = term.flatMap((t) => t.outsideMonth.examples);
    expect(outside).toHaveLength(1);
    expect(outside[0]).toMatchObject({ ref: 'G4', detail: '2026-11-05' });
    expect(run.facts.some((f) => f.ref === 'G4')).toBe(true);
  });

  it('every row offered to a term is a fact or is counted', async () => {
    const run = await defaultRun();
    for (const t of run.diagnostics.terms) {
      const counted = t.facts + t.filtered + t.ipViaOp.count + t.filterError.count + t.badAmount.count;
      expect(counted, `${t.sourceId} ${t.measure}`).toBe(t.rowsConsidered);
    }
  });

  it('counts rows skipped before the rules: total rows with their values, blank rows', async () => {
    const run = await defaultRun();
    const discharge = run.diagnostics.sources.find((s) => s.sourceId === 'ipDischarge');
    expect(discharge).toMatchObject({ status: 'read', rowsRead: 5, rowsMapped: 4, footerRows: 1 });
    expect(discharge?.skipped.noReference.count).toBe(1);
    expect(discharge?.footerTotals.grossAmount).toBe(1680000);
    expect(discharge?.fieldTotals.grossAmount).toBe(1680000); // the file's own total agrees with its rows
  });

  it('lists the unknown doctor once, with how many source rows', async () => {
    const run = await defaultRun();
    expect(run.diagnostics.unmatchedDoctors).toEqual([
      { raw: 'Dr Unknown', rows: 1, sources: ['ipDischarge'], ambiguous: false },
    ]);
  });

  it('keeps facts with an unmatched doctor, so report totals still tie to the sources', async () => {
    const run = await defaultRun();
    const unmatched = run.facts.filter((f) => f.doctorId === null);
    expect(unmatched.map((f) => f.measure)).toEqual(['IP_COUNT']);
    const total = totalValues(pivot(run.facts, 'doctor'));
    expect(total.IP_COUNT).toBe(4);
  });

  it('report totals equal the source totals for every measure', async () => {
    const run = await defaultRun();
    const sums = sumFacts(run.facts);
    const termSums = new Map<MeasureCode, number>();
    for (const t of run.diagnostics.terms) termSums.set(t.measure, (termSums.get(t.measure) ?? 0) + t.sumPaise);
    for (const [measure, sum] of termSums) expect(sums[measure] ?? 0, measure).toBe(sum);
    expect(totalValues(pivot(run.facts, 'doctor')).OP_PHARMACY).toBe(sums.OP_PHARMACY);
  });
});

describe('what the run reports about its inputs', () => {
  it('fingerprints every file and finds no duplicates', async () => {
    const run = await defaultRun();
    expect(run.diagnostics.fingerprints).toHaveLength(7); // ipAdmissions is not used by any rule, so it is not read
    expect(run.diagnostics.fingerprints.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
    expect(run.diagnostics.duplicateFiles).toEqual([]);
  });

  it('flags the same file used for two sources', async () => {
    const req = monthRequest();
    const billing = req.files.find((f) => f.sourceId === 'opBilling')!.file;
    // OP Consultations gets the OP Billing file: it no longer fits its mapping, and is also a duplicate.
    req.files = req.files.map((f) => (f.sourceId === 'opConsultations' ? { ...f, file: billing } : f));
    const run = await runMonthTask(req);
    expect(run.diagnostics.duplicateFiles).toHaveLength(1);
    expect(run.diagnostics.duplicateFiles[0]?.sourceIds.sort()).toEqual(['opBilling', 'opConsultations']);
  });

  it('flags a source whose file does not fit its mapping, and reads nothing from it', async () => {
    const req = monthRequest();
    const wrong = req.files.find((f) => f.sourceId === 'opBilling')!.file;
    req.files = req.files.map((f) => (f.sourceId === 'ipGeneralBill' ? { ...f, file: wrong } : f));
    const run = await runMonthTask(req);
    const diag = run.diagnostics.sources.find((s) => s.sourceId === 'ipGeneralBill');
    expect(diag?.status).toBe('flagged');
    expect(diag?.problems.length).toBeGreaterThan(0);
    expect(run.facts.some((f) => f.sourceId === 'ipGeneralBill')).toBe(false);
  });

  it('reports a needed source with no file as missing, and does not need an unused one', async () => {
    const req = monthRequest();
    req.files = req.files.filter((f) => f.sourceId !== 'opReturns');
    const run = await runMonthTask(req);
    expect(run.diagnostics.sources.find((s) => s.sourceId === 'opReturns')).toMatchObject({ status: 'missing', needed: true });
    expect(run.diagnostics.sources.find((s) => s.sourceId === 'ipAdmissions')).toMatchObject({ status: 'missing', needed: false });
  });

  it('does not read a source whose mapping was never confirmed', async () => {
    const settings = monthSettings();
    settings.sources.sources = settings.sources.sources.filter((m) => m.sourceId !== 'opBilling');
    const run = await runMonthTask(monthRequest(settings));
    const diag = run.diagnostics.sources.find((s) => s.sourceId === 'opBilling');
    expect(diag?.status).toBe('flagged');
    expect(diag?.problems[0]?.message).toMatch(/not been confirmed/);
  });

  it('reports a rule formula that cannot be read instead of guessing', async () => {
    const settings = monthSettings();
    const rule = settings.rules.rules.find((r) => r.measure === 'IP_REVENUE');
    if (rule?.kind === 'source') rule.terms[0]!.value = { type: 'formula', formula: '[grossAmount] -' };
    const run = await runMonthTask(monthRequest(settings));
    expect(run.diagnostics.ruleProblems[0]).toMatch(/IP_REVENUE.*not a valid formula/);
  });

  it('every fact row has the shape in CLAUDE.md and carries no patient fields', async () => {
    const run = await defaultRun();
    const allowed = new Set<keyof FactRow>([
      'month', 'measure', 'amountPaise', 'doctorId', 'departmentId', 'sponsor', 'sourceId', 'sourceFile',
      'sourceRow', 'ref', 'umrno', 'txnDate', 'attributionMethod', 'attributionStatus',
    ]);
    for (const f of run.facts) {
      expect(Object.keys(f).every((k) => allowed.has(k as keyof FactRow))).toBe(true);
      expect(Number.isInteger(f.amountPaise)).toBe(true);
      expect(f.month).toBe(MONTH);
    }
  });
});

describe('overlap of OP Billing and OP Consultations', () => {
  it('counts patient + date pairs found in both', async () => {
    const run = await defaultRun();
    // U1 on 2 Oct and U2 on 3 Oct appear in both files.
    expect(run.diagnostics.opOverlap.pairs).toBe(2);
  });
});

describe('an unreadable amount in a field a rule only filters on', () => {
  it('is counted and left out too, never guessed at', async () => {
    const settings = monthSettings();
    const rule = settings.rules.rules.find((r) => r.measure === 'IP_REVENUE');
    // Cleared bills only, and only when the concession can be read as a number.
    if (rule?.kind === 'source') rule.terms[0]!.filter = 'AND([status] <> "PENDING", [concession] >= 0)';
    const req = monthRequest(settings);
    req.files = req.files.map((f) =>
      f.sourceId === 'ipGeneralBill'
        ? {
            ...f,
            file: hisFile('IP General Bill Breakup Oct2026.xlsx', MONTH_DATA.ipGeneralBill.header, [
              ['G1', '02-OCT-2026', 'IP1', 1000, 'oops', 'CLEARED', 'Dr. A Kumar', 'cardiology', 'GENERAL'],
              ['G2', '03-OCT-2026', 'IP2', 2000, 100, 'CLEARED', 'Dr. A Kumar', 'cardiology', 'STAR'],
            ]),
          }
        : f,
    );
    const run = await runMonthTask(req);
    const term = run.diagnostics.terms.find((t) => t.measure === 'IP_REVENUE' && t.termIndex === 0)!;
    expect(term.badAmount.count).toBe(1);
    expect(term.badAmount.examples[0]).toMatchObject({ ref: 'G1' });
    expect(term.facts).toBe(1); // only G2
    expect(term.facts + term.filtered + term.badAmount.count + term.filterError.count + term.ipViaOp.count).toBe(term.rowsConsidered);
  });
});
