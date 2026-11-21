import { beforeAll, describe, expect, it } from 'vitest';
import { UNMATCHED_KEY } from '@/core/aggregate';
import { runChecks } from '@/core/checks';
import { monthLabel } from '@/core/dates';
import { NO_SPONSOR_NAME, UNMATCHED_DOCTOR_NAME, doctorReport, reportTotals, sponsorReport } from '@/core/report';
import type { RunOutput } from '@/core/runMonth';
import { SCHEMA_VERSION, type RunInfoFile, type SettingsUsedFile } from '@/core/schemas';
import { UNATTRIBUTED_DOCTOR_ID, UNATTRIBUTED_DOCTOR_NAME, type CostEntry } from '@/core/types';
import {
  FinalRunError,
  findPreviousFinal,
  finalizeRun,
  latestFinalRun,
  listRuns,
  readRun,
  writeRun,
  type RunBundle,
} from '@/storage/runs';
import { Workspace } from '@/storage/workspace';
import { runMonthTask } from '@/worker/tasks/runMonth';
import { DOCTORS, DR_A, DR_B, MONTH, monthRequest, monthSettings } from '../helpers/monthFixture';
import { MemoryDir } from '../helpers/memoryFs';

const costs: CostEntry[] = [
  { doctorId: DR_A, amounts: { DEPT_ISSUES: 100000, SALARY: 500000, INCENTIVES: 50000, PROF_FEE: 250000 } },
  { doctorId: 'gone', amounts: { SALARY: 999 } },
];

let run: RunOutput;
beforeAll(async () => {
  run = await runMonthTask(monthRequest());
});

describe('doctorReport', () => {
  it('has one row per doctor with activity, named doctors A-Z, then pharmacy unattributed, then unmatched', () => {
    const rows = doctorReport(run.facts, costs, DOCTORS, MONTH);
    expect(rows.map((r) => r.name)).toEqual(['A Kumar', 'B Rao', UNATTRIBUTED_DOCTOR_NAME, UNMATCHED_DOCTOR_NAME]);
    expect(rows.map((r) => r.sNo)).toEqual([1, 2, 3, 4]);
    expect(rows[0]).toMatchObject({ key: DR_A, department: 'Cardiology', month: MONTH, monthLabel: 'Oct-2026' });
    expect(rows[2]?.key).toBe(UNATTRIBUTED_DOCTOR_ID);
    expect(rows[3]?.key).toBe(UNMATCHED_KEY);
  });

  it('puts Total Revenue and Gross Profit in paise, with the costs of the doctor', () => {
    const a = doctorReport(run.facts, costs, DOCTORS, MONTH)[0]!.values;
    // IP 1,150,025 + OP 40,000 + OP pharmacy 12,000 paise
    expect(a.IP_REVENUE).toBe(1150025);
    expect(a.TOTAL_REVENUE).toBe(1150025 + 40000 + 12000);
    // minus OP pharmacy cost 9,000, IP pharmacy cost 60,005, issues 100,000, salary 500,000, incentives 50,000, fee 250,000
    expect(a.GROSS_PROFIT).toBe(a.TOTAL_REVENUE - 9000 - 60005 - 100000 - 500000 - 50000 - 250000);
  });

  it('leaves out costs of doctors who are not in the list instead of inventing a row', () => {
    expect(doctorReport(run.facts, costs, DOCTORS, MONTH).some((r) => r.key === 'gone')).toBe(false);
  });

  it('shows a doctor who has only costs', () => {
    const rows = doctorReport([], [{ doctorId: DR_B, amounts: { SALARY: 100 } }], DOCTORS, MONTH);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'B Rao', department: 'Urology' });
    expect(rows[0]?.values.GROSS_PROFIT).toBe(-100);
  });

  it('totals equal the sum of the rows, calculated columns included', () => {
    const rows = doctorReport(run.facts, costs, DOCTORS, MONTH);
    const total = reportTotals(rows);
    for (const key of ['TOTAL_REVENUE', 'GROSS_PROFIT', 'IP_COUNT'] as const) {
      expect(total[key]).toBe(rows.reduce((n, r) => n + r.values[key], 0));
    }
  });
});

describe('sponsorReport', () => {
  it('has one row per sponsor, upper-cased as in the files, and no cost columns filled', () => {
    const rows = sponsorReport(run.facts, MONTH);
    expect(rows.map((r) => r.name)).toEqual(['GENERAL', 'STAR']);
    expect(rows.every((r) => r.department === '' && r.values.SALARY === 0)).toBe(true);
  });
  it('Gross Profit of a sponsor is Total Revenue - OP pharmacy cost - IP pharmacy cost', () => {
    const general = sponsorReport(run.facts, MONTH).find((r) => r.name === 'GENERAL')!.values;
    expect(general.GROSS_PROFIT).toBe(general.TOTAL_REVENUE - general.OP_PHARMACY_COST - general.IP_PHARMACY_COST);
  });
  it('puts facts with no sponsor in their own last row', () => {
    const rows = sponsorReport([{ ...run.facts[0]!, sponsor: null }, run.facts.find((f) => f.sponsor === 'STAR')!], MONTH);
    expect(rows.at(-1)?.name).toBe(NO_SPONSOR_NAME);
  });
  it('both reports hold the same grand total of Total Revenue', () => {
    expect(reportTotals(sponsorReport(run.facts, MONTH)).TOTAL_REVENUE).toBe(reportTotals(doctorReport(run.facts, costs, DOCTORS, MONTH)).TOTAL_REVENUE);
  });
});

describe('monthLabel', () => {
  it('writes a short month and year', () => {
    expect(monthLabel('2026-10')).toBe('Oct-2026');
    expect(monthLabel('2027-01')).toBe('Jan-2027');
  });
});

// ---------------------------------------------------------------------------
// Saved runs
// ---------------------------------------------------------------------------

function bundle(month: string, runNumber: number, status: 'Draft' | 'Final' = 'Draft', reason: string | null = null): RunBundle {
  const settings = monthSettings();
  const settingsUsed: SettingsUsedFile = { version: SCHEMA_VERSION, sources: settings.sources, doctors: settings.doctors, rules: settings.rules, costsDefaults: null };
  const info: RunInfoFile = {
    version: SCHEMA_VERSION,
    month,
    runNumber,
    status,
    createdAt: '2026-11-02T10:00:00.000Z',
    ...(status === 'Final' ? { finalizedAt: '2026-11-03T10:00:00.000Z' } : {}),
    operatorName: 'Ram',
    reason,
    files: run.diagnostics.fingerprints,
  };
  return {
    info,
    facts: { version: SCHEMA_VERSION, month, runNumber, facts: run.facts.map((f) => ({ ...f, month })) },
    costs: { version: SCHEMA_VERSION, month, operatorName: 'Ram', updatedAt: '2026-11-01T10:00:00.000Z', entries: [{ doctorId: DR_A, amounts: { SALARY: 100 } }] },
    checks: { version: SCHEMA_VERSION, month, runNumber, checks: runChecks({ month, rules: settings.rules, doctors: DOCTORS, diagnostics: run.diagnostics, facts: run.facts, costs: [], previous: null }) },
    settingsUsed,
  };
}

describe('run storage', () => {
  it('saves all five files of a run, a copy of the settings included, and reads them back', async () => {
    const root = new MemoryDir('ws');
    const ws = new Workspace(root);
    const b = bundle('2026-10', 1);
    await writeRun(ws, b);

    expect(root.allPaths().filter((p) => p.includes('run-1'))).toEqual([
      'data/2026-10/run-1/checks.json',
      'data/2026-10/run-1/costs.json',
      'data/2026-10/run-1/facts.json',
      'data/2026-10/run-1/run-info.json',
      'data/2026-10/run-1/settings-used.json',
    ]);
    const back = await readRun(ws, '2026-10', 1);
    expect(back.info).toEqual(b.info);
    expect(back.facts.facts).toHaveLength(run.facts.length);
    expect(back.settingsUsed.rules.flags).toEqual(b.settingsUsed.rules.flags);
    expect(back.info.files.length).toBe(7); // fingerprints of the files used
  });

  it('writes run-info.json last, so a half-saved run never looks saved', async () => {
    const root = new MemoryDir('ws');
    await writeRun(new Workspace(root), bundle('2026-10', 1));
    const writes = root.log.filter((l) => l.startsWith('write '));
    expect(writes.at(-1)).toBe('write run-info.json.tmp');
    expect(writes.indexOf('write facts.json.tmp')).toBeLessThan(writes.indexOf('write run-info.json.tmp'));
  });

  it('refuses to save facts that do not pass the schema (for example a patient name)', async () => {
    const ws = new Workspace(new MemoryDir('ws'));
    const b = bundle('2026-10', 1);
    (b.facts.facts[0] as Record<string, unknown>).patientName = 'Someone';
    await expect(writeRun(ws, b)).rejects.toThrow(/Refusing to save/);
  });

  it('a Final run is read-only', async () => {
    const root = new MemoryDir('ws');
    const ws = new Workspace(root);
    await writeRun(ws, bundle('2026-10', 1, 'Final'));
    const before = root.allPaths().length;
    await expect(writeRun(ws, bundle('2026-10', 1))).rejects.toThrow(FinalRunError);
    await expect(finalizeRun(ws, '2026-10', 1, [])).rejects.toThrow(/already Final/);
    expect(root.allPaths().length).toBe(before);
    expect((await readRun(ws, '2026-10', 1)).info.status).toBe('Final');
  });

  it('a Draft run can be saved again, and made Final with its notes', async () => {
    const ws = new Workspace(new MemoryDir('ws'));
    await writeRun(ws, bundle('2026-10', 1));
    await writeRun(ws, bundle('2026-10', 1)); // overwritten, still a draft
    const noted = bundle('2026-10', 1).checks.checks.map((c) => (c.level === 'Warning' ? { ...c, note: 'Reviewed' } : c));
    const info = await finalizeRun(ws, '2026-10', 1, noted, new Date('2026-11-05T04:30:00Z'));
    expect(info).toMatchObject({ status: 'Final', finalizedAt: '2026-11-05T04:30:00.000Z' });
    const back = await readRun(ws, '2026-10', 1);
    expect(back.info.status).toBe('Final');
    expect(back.checks.checks.filter((c) => c.level === 'Warning').every((c) => c.note === 'Reviewed')).toBe(true);
  });

  it('will not finalize a run that was never saved', async () => {
    await expect(finalizeRun(new Workspace(new MemoryDir('ws')), '2026-10', 1, [])).rejects.toThrow(/has not been saved/);
  });

  it('keeps a Final run when it is re-run: the new run is run-2, with its reason', async () => {
    const ws = new Workspace(new MemoryDir('ws'));
    await writeRun(ws, bundle('2026-10', 1, 'Final'));
    await writeRun(ws, bundle('2026-10', 2, 'Draft', 'A late bill was added'));
    const runs = await listRuns(ws, '2026-10');
    expect(runs.map((r) => [r.runNumber, r.info?.status, r.info?.reason])).toEqual([
      [1, 'Final', null],
      [2, 'Draft', 'A late bill was added'],
    ]);
    expect(await latestFinalRun(ws, '2026-10')).toBe(1);
  });

  it('does not overwrite a run whose run-info is damaged', async () => {
    const ws = new Workspace(new MemoryDir('ws'));
    await ws.writeFile('data/2026-10/run-1/run-info.json', '{ broken');
    await expect(writeRun(ws, bundle('2026-10', 1))).rejects.toThrow(/damaged/);
    expect((await listRuns(ws, '2026-10'))[0]).toMatchObject({ runNumber: 1, info: null });
  });

  it('finds the most recent earlier Final month for the change check', async () => {
    const ws = new Workspace(new MemoryDir('ws'));
    await writeRun(ws, bundle('2026-08', 1, 'Final'));
    await writeRun(ws, bundle('2026-09', 1, 'Draft')); // a draft is not a Final month
    await writeRun(ws, bundle('2026-10', 1, 'Final')); // the month itself is not "previous"
    const prev = await findPreviousFinal(ws, '2026-10');
    expect(prev?.month).toBe('2026-08');
    expect(prev?.facts.length).toBe(run.facts.length);
    expect(await findPreviousFinal(ws, '2026-08')).toBeNull();
  });
});
