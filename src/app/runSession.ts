// The month being run: starting a run in the worker, checking it, saving it as a
// Draft, making it Final, and opening a saved run. All the logic of the Run page
// lives here, so the components only show state and call these functions.

import { create } from 'zustand';
import { finalBlockers, runChecks, withNotes } from '@/core/checks';
import { defaultReportMonth } from '@/core/dates';
import { findDuplicateFiles, type RunSettings } from '@/core/runMonth';
import {
  SCHEMA_VERSION,
  type CostsFile,
  type RunInfoFile,
  type SettingsUsedFile,
} from '@/core/schemas';
import type { CheckResult, CostEntry, FactRow, FileFingerprint, RunStatus } from '@/core/types';
import { SOURCE_IDS } from '@/core/types';
import { readCostsDraft } from '@/storage/costs';
import { findPreviousFinal, finalizeRun, listRuns, readRun, writeRun, type RunSummary } from '@/storage/runs';
import type { Workspace } from '@/storage/workspace';
import { runMonthInWorker } from '@/worker/client';
import type { TaskProgress } from '@/worker/protocol';
import { fileForSource, useFiles } from './filesStore';
import { useSettings } from './settingsStore';

/** What the Run page shows: a fresh run, or a saved one opened for viewing. */
export type RunResult = {
  month: string;
  facts: FactRow[];
  costs: CostEntry[];
  /** Checks as computed, or as saved (with their notes) for a saved run. */
  checks: CheckResult[];
  /** The settings the run used. */
  settings: RunSettings;
  fingerprints: FileFingerprint[];
  /** Where it is saved; null for a run that has not been saved yet. */
  saved: { runNumber: number; status: RunStatus; reason: string | null } | null;
  /** The costs file the run used (kept for the copy saved with the run). */
  costsFile: CostsFile | null;
};

type RunState = {
  month: string;
  status: 'idle' | 'running' | 'ready' | 'error';
  progress: TaskProgress | null;
  error: string | null;
  result: RunResult | null;
  /** Typed notes on warnings, by check id. */
  notes: Record<string, string>;
  /** Runs already saved for the month. */
  savedRuns: RunSummary[];
  /** Costs entered for the month (null while loading). */
  costsEntered: boolean | null;
  busy: 'saving' | 'finalizing' | null;
};

export const useRun = create<RunState>()(() => ({
  month: defaultReportMonth(),
  status: 'idle',
  progress: null,
  error: null,
  result: null,
  notes: {},
  savedRuns: [],
  costsEntered: null,
  busy: null,
}));

const set = useRun.setState;
const get = useRun.getState;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Look at what is already saved for a month: its runs and whether costs were entered. */
export async function refreshMonth(ws: Workspace, month: string): Promise<void> {
  try {
    const [savedRuns, costs] = await Promise.all([listRuns(ws, month), readCostsDraft(ws, month)]);
    if (get().month !== month) return;
    set({ savedRuns, costsEntered: costs !== null && costs.entries.some((e) => Object.keys(e.amounts).length > 0) });
  } catch (err) {
    set({ error: `Could not read the saved data for ${month}: ${message(err)}` });
  }
}

/** Choose another month: the current result is dropped. */
export function chooseMonth(ws: Workspace, month: string): void {
  set({ month, status: 'idle', result: null, notes: {}, error: null, progress: null, savedRuns: [], costsEntered: null });
  void refreshMonth(ws, month);
}

/** The newest saved run of the month. */
function latest(runs: readonly RunSummary[]): RunSummary | undefined {
  return runs.at(-1);
}

/** What saving a run now would do: which run number, and whether a reason is needed. */
export function savePlan(runs: readonly RunSummary[], result: RunResult | null): { runNumber: number; needsReason: boolean } {
  if (result?.saved?.status === 'Draft') return { runNumber: result.saved.runNumber, needsReason: false };
  const last = latest(runs);
  if (!last) return { runNumber: 1, needsReason: false };
  // A Draft is overwritten; a Final run is never touched, so a new run is made and needs a reason.
  return last.info?.status === 'Draft' ? { runNumber: last.runNumber, needsReason: false } : { runNumber: last.runNumber + 1, needsReason: true };
}

/** Run the month with the files loaded in this session. */
export async function startRun(ws: Workspace): Promise<void> {
  const { month } = get();
  const settings = useSettings.getState();
  const loaded = useFiles.getState().files;
  const files = SOURCE_IDS.flatMap((sourceId) => {
    const f = fileForSource(loaded, sourceId);
    return f ? [{ sourceId, file: f.file }] : [];
  });

  set({ status: 'running', progress: { stage: 'Starting', fraction: 0 }, error: null, result: null, notes: {} });
  try {
    const run: RunSettings = structuredClone({ sources: settings.sources, doctors: settings.doctors, rules: settings.rules });
    const [costsFile, previous] = await Promise.all([readCostsDraft(ws, month), findPreviousFinal(ws, month)]);
    const output = await runMonthInWorker({ month, files, settings: run }, (progress) => set({ progress }));

    // The same file loaded twice (even for one source) must not slip through unnoticed.
    const duplicateLoadedFiles = findDuplicateFiles(
      loaded.flatMap((f) => (f.state === 'ready' && f.sourceId && f.sha256 ? [{ sourceId: f.sourceId, fileName: f.file.name, sha256: f.sha256 }] : [])),
    );
    const costs = costsFile?.entries ?? [];
    const checks = runChecks({
      month,
      rules: run.rules,
      doctors: run.doctors.doctors,
      diagnostics: output.diagnostics,
      facts: output.facts,
      costs,
      previous,
      duplicateLoadedFiles,
    });
    set({
      status: 'ready',
      progress: null,
      result: { month, facts: output.facts, costs, checks, settings: run, fingerprints: output.diagnostics.fingerprints, saved: null, costsFile },
    });
    await refreshMonth(ws, month);
  } catch (err) {
    set({ status: 'error', progress: null, error: message(err) });
  }
}

/** Open a saved run for viewing. A Final run is read-only. */
export async function openRun(ws: Workspace, runNumber: number): Promise<void> {
  const { month } = get();
  set({ status: 'running', progress: { stage: 'Opening the saved run', fraction: 0.5 }, error: null });
  try {
    const bundle = await readRun(ws, month, runNumber);
    const notes = Object.fromEntries(bundle.checks.checks.flatMap((c) => (c.note ? [[c.id, c.note]] : [])));
    set({
      status: 'ready',
      progress: null,
      notes,
      result: {
        month,
        facts: bundle.facts.facts,
        costs: bundle.costs.entries,
        checks: bundle.checks.checks,
        settings: { sources: bundle.settingsUsed.sources, doctors: bundle.settingsUsed.doctors, rules: bundle.settingsUsed.rules },
        fingerprints: bundle.info.files,
        saved: { runNumber, status: bundle.info.status, reason: bundle.info.reason },
        costsFile: bundle.costs,
      },
    });
  } catch (err) {
    set({ status: 'error', progress: null, error: `Could not open run ${runNumber}: ${message(err)}` });
  }
}

export function setNote(checkId: string, note: string): void {
  set((s) => ({ notes: { ...s.notes, [checkId]: note } }));
}

/** Checks with the typed notes attached. */
export function checksWithNotes(result: RunResult, notes: Record<string, string>): CheckResult[] {
  return withNotes(result.checks, notes);
}

type SaveOptions = { operatorName: string; reason: string };

/** Save the result as a Draft run (a Draft is overwritten, a Final run never). Returns the run number. */
export async function saveDraft(ws: Workspace, { operatorName, reason }: SaveOptions): Promise<number> {
  const { result, notes, savedRuns } = get();
  if (!result) throw new Error('There is no run to save yet.');
  if (result.saved?.status === 'Final') throw new Error('This run is Final and cannot be changed.');
  if (operatorName.trim() === '') throw new Error('Enter your name before saving, so the run can be traced.');

  const plan = savePlan(savedRuns, result);
  if (plan.needsReason && reason.trim() === '') throw new Error('Say why you are running this month again (the earlier run is Final).');

  set({ busy: 'saving' });
  try {
    const now = new Date().toISOString();
    const previous = savedRuns.find((r) => r.runNumber === plan.runNumber)?.info;
    const info: RunInfoFile = {
      version: SCHEMA_VERSION,
      month: result.month,
      runNumber: plan.runNumber,
      status: 'Draft',
      createdAt: now,
      operatorName: operatorName.trim(),
      reason: plan.needsReason ? reason.trim() : (previous?.reason ?? null),
      files: result.fingerprints,
    };
    const settingsUsed: SettingsUsedFile = {
      version: SCHEMA_VERSION,
      sources: result.settings.sources,
      doctors: result.settings.doctors,
      rules: result.settings.rules,
      costsDefaults: null,
    };
    const costs: CostsFile = {
      version: SCHEMA_VERSION,
      month: result.month,
      operatorName: result.costsFile?.operatorName ?? '',
      updatedAt: result.costsFile?.updatedAt ?? now,
      entries: result.costs,
    };
    await writeRun(ws, {
      info,
      facts: { version: SCHEMA_VERSION, month: result.month, runNumber: plan.runNumber, facts: result.facts },
      costs,
      checks: { version: SCHEMA_VERSION, month: result.month, runNumber: plan.runNumber, checks: checksWithNotes(result, notes) },
      settingsUsed,
    });
    set({ result: { ...result, saved: { runNumber: plan.runNumber, status: 'Draft', reason: info.reason } } });
    await refreshMonth(ws, result.month);
    return plan.runNumber;
  } finally {
    set({ busy: null });
  }
}

/** Why the run cannot be made Final yet (empty = it can). */
export function blockers(result: RunResult | null, notes: Record<string, string>): string[] {
  return result ? finalBlockers(checksWithNotes(result, notes)) : [];
}

/** Make the run Final. It is saved first if needed. Throws if a Fail or an un-noted Warning remains. */
export async function markFinal(ws: Workspace, options: SaveOptions): Promise<number> {
  const { result, notes } = get();
  if (!result) throw new Error('There is no run to finish yet.');
  const reasons = blockers(result, notes);
  if (reasons.length > 0) throw new Error(`This run cannot be made Final yet. ${reasons.join(' ')}`);

  const runNumber = await saveDraft(ws, options);
  set({ busy: 'finalizing' });
  try {
    const checks = checksWithNotes(get().result as RunResult, notes);
    const info = await finalizeRun(ws, result.month, runNumber, checks);
    set((s) => (s.result ? { result: { ...s.result, checks, saved: { runNumber, status: 'Final', reason: info.reason } } } : {}));
    await refreshMonth(ws, result.month);
    return runNumber;
  } finally {
    set({ busy: null });
  }
}
