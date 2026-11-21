import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { blockers, markFinal, saveDraft, savePlan, useRun, type RunResult } from '@/app/runSession';
import { runChecks } from '@/core/checks';
import type { RunOutput } from '@/core/runMonth';
import { listRuns, readRun } from '@/storage/runs';
import { Workspace } from '@/storage/workspace';
import { runMonthTask } from '@/worker/tasks/runMonth';
import { MemoryDir } from '../helpers/memoryFs';
import { DOCTORS, MONTH, monthRequest, monthSettings } from '../helpers/monthFixture';

let output: RunOutput;
beforeAll(async () => {
  output = await runMonthTask(monthRequest());
});

function freshResult(failing = true): RunResult {
  const settings = monthSettings();
  const checks = runChecks({
    month: MONTH, rules: settings.rules, doctors: DOCTORS, diagnostics: output.diagnostics, facts: output.facts,
    costs: [{ doctorId: 'a-kumar', amounts: { SALARY: 1 } }], previous: null,
  }).map((c) => (!failing && c.level === 'Fail' ? { ...c, level: 'Pass' as const } : c));
  return { month: MONTH, facts: output.facts, costs: [], checks, settings, fingerprints: output.diagnostics.fingerprints, saved: null, costsFile: null };
}

let ws: Workspace;
beforeEach(() => {
  ws = new Workspace(new MemoryDir('ws'));
  useRun.setState({ month: MONTH, status: 'ready', result: null, notes: {}, savedRuns: [], busy: null, error: null });
});

const noteAllWarnings = (result: RunResult) =>
  Object.fromEntries(result.checks.filter((c) => c.level === 'Warning').map((c) => [c.id, 'Reviewed']));

describe('savePlan', () => {
  const run = (n: number, status: 'Draft' | 'Final') => ({ runNumber: n, info: { status } as never });

  it('starts at run 1', () => expect(savePlan([], null)).toEqual({ runNumber: 1, needsReason: false }));
  it('overwrites the newest Draft', () => expect(savePlan([run(1, 'Final'), run(2, 'Draft')], null)).toEqual({ runNumber: 2, needsReason: false }));
  it('makes a new run after a Final one, and then a reason is required', () =>
    expect(savePlan([run(1, 'Final')], null)).toEqual({ runNumber: 2, needsReason: true }));
  it('keeps saving a run to the Draft it was already saved as', () =>
    expect(savePlan([run(1, 'Draft')], { saved: { runNumber: 1, status: 'Draft', reason: null } } as RunResult)).toEqual({ runNumber: 1, needsReason: false }));
});

describe('saveDraft', () => {
  it('needs a name', async () => {
    useRun.setState({ result: freshResult() });
    await expect(saveDraft(ws, { operatorName: '  ', reason: '' })).rejects.toThrow(/Enter your name/);
    expect(await listRuns(ws, MONTH)).toEqual([]);
  });

  it('saves a Draft with the settings used, the fingerprints and the notes', async () => {
    useRun.setState({ result: freshResult(), notes: { 'unknown-doctors': 'Dr Unknown is a visiting doctor' } });
    expect(await saveDraft(ws, { operatorName: 'Ram', reason: '' })).toBe(1);

    const saved = await readRun(ws, MONTH, 1);
    expect(saved.info).toMatchObject({ month: MONTH, runNumber: 1, status: 'Draft', operatorName: 'Ram', reason: null });
    expect(saved.info.files).toHaveLength(7);
    expect(saved.settingsUsed.rules.flags).toEqual(monthSettings().rules.flags);
    expect(saved.checks.checks.find((c) => c.id === 'unknown-doctors')?.note).toBe('Dr Unknown is a visiting doctor');
    expect(useRun.getState().result?.saved).toEqual({ runNumber: 1, status: 'Draft', reason: null });
    expect(useRun.getState().savedRuns.map((r) => r.runNumber)).toEqual([1]);
  });

  it('saves again over the same Draft instead of piling up runs', async () => {
    useRun.setState({ result: freshResult() });
    await saveDraft(ws, { operatorName: 'Ram', reason: '' });
    await saveDraft(ws, { operatorName: 'Ram', reason: '' });
    expect((await listRuns(ws, MONTH)).map((r) => r.runNumber)).toEqual([1]);
  });
});

describe('markFinal', () => {
  it('is refused while a check fails, and nothing is saved', async () => {
    useRun.setState({ result: freshResult(true) });
    await expect(markFinal(ws, { operatorName: 'Ram', reason: '' })).rejects.toThrow(/cannot be made Final.*Fix: Amounts can be read/);
    expect(await listRuns(ws, MONTH)).toEqual([]);
  });

  it('is refused while a warning has no note', async () => {
    useRun.setState({ result: freshResult(false) });
    await expect(markFinal(ws, { operatorName: 'Ram', reason: '' })).rejects.toThrow(/Add a note to the warning/);
  });

  it('makes the run Final with every warning noted, and it can no longer be saved over', async () => {
    const result = freshResult(false);
    useRun.setState({ result, notes: noteAllWarnings(result) });
    expect(blockers(result, noteAllWarnings(result))).toEqual([]);
    expect(await markFinal(ws, { operatorName: 'Ram', reason: '' })).toBe(1);

    const saved = await readRun(ws, MONTH, 1);
    expect(saved.info.status).toBe('Final');
    expect(saved.info.finalizedAt).toBeDefined();
    expect(useRun.getState().result?.saved?.status).toBe('Final');
    await expect(saveDraft(ws, { operatorName: 'Ram', reason: '' })).rejects.toThrow(/Final and cannot be changed/);
  });

  it('running a Final month again makes run 2, and requires a reason', async () => {
    const first = freshResult(false);
    useRun.setState({ result: first, notes: noteAllWarnings(first) });
    await markFinal(ws, { operatorName: 'Ram', reason: '' });

    // A fresh run of the same month (nothing saved yet), with the Final run on disk.
    const again = freshResult(false);
    useRun.setState({ result: again, notes: noteAllWarnings(again) });
    await expect(saveDraft(ws, { operatorName: 'Ram', reason: '' })).rejects.toThrow(/Say why you are running this month again/);
    expect(await saveDraft(ws, { operatorName: 'Ram', reason: 'A late bill was added' })).toBe(2);

    const runs = await listRuns(ws, MONTH);
    expect(runs.map((r) => [r.runNumber, r.info?.status, r.info?.reason])).toEqual([
      [1, 'Final', null],
      [2, 'Draft', 'A late bill was added'],
    ]);
    expect((await readRun(ws, MONTH, 1)).info.status).toBe('Final'); // the Final run is untouched
  });
});
