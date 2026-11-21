// Saved runs: data/<month>/run-<n>/ {facts, costs, checks, settings-used, run-info}.json
//
// A Final run is read-only: nothing in its folder is ever written again.
// run-info.json is written last, so a run whose other files are incomplete
// never claims to be saved.

import type { z } from 'zod';
import {
  ChecksFileSchema,
  CostsFileSchema,
  FactsFileSchema,
  RunInfoSchema,
  SCHEMA_VERSION,
  SettingsUsedFileSchema,
  type ChecksFile,
  type CostsFile,
  type FactsFile,
  type RunInfoFile,
  type SettingsUsedFile,
} from '@/core/schemas';
import type { CheckResult, FactRow } from '@/core/types';
import { isMonthDirName, joinPath, parseRunDirName, paths, type Workspace } from './workspace';

export const RUN_FILES = {
  facts: 'facts.json',
  costs: 'costs.json',
  checks: 'checks.json',
  settingsUsed: 'settings-used.json',
  info: 'run-info.json',
} as const;

export type RunBundle = {
  info: RunInfoFile;
  facts: FactsFile;
  costs: CostsFile;
  checks: ChecksFile;
  settingsUsed: SettingsUsedFile;
};

export class FinalRunError extends Error {
  override name = 'FinalRunError';
}

const file = (month: string, runNumber: number, name: string) => joinPath(paths.run(month, runNumber), name);

/** Run numbers saved for a month, ascending. */
export async function listRunNumbers(ws: Workspace, month: string): Promise<number[]> {
  return (await ws.listDirs(paths.month(month)))
    .map(parseRunDirName)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
}

export type RunSummary = { runNumber: number; info: RunInfoFile | null; error?: string };

/** The runs of a month with their run-info (a damaged run-info is reported, not hidden). */
export async function listRuns(ws: Workspace, month: string): Promise<RunSummary[]> {
  const out: RunSummary[] = [];
  for (const runNumber of await listRunNumbers(ws, month)) {
    try {
      out.push({ runNumber, info: await ws.readJson(file(month, runNumber, RUN_FILES.info), RunInfoSchema) });
    } catch (err) {
      out.push({ runNumber, info: null, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

async function readInfo(ws: Workspace, month: string, runNumber: number): Promise<RunInfoFile | null> {
  return ws.readJson(file(month, runNumber, RUN_FILES.info), RunInfoSchema);
}

/** Throws if the run is Final. A damaged run-info is treated as Final: when in doubt, do not overwrite. */
async function assertWritable(ws: Workspace, month: string, runNumber: number): Promise<void> {
  try {
    const info = await readInfo(ws, month, runNumber);
    if (info?.status === 'Final') {
      throw new FinalRunError(`Run ${runNumber} of ${month} is Final and cannot be changed. Save a new run instead.`);
    }
  } catch (err) {
    if (err instanceof FinalRunError) throw err;
    throw new FinalRunError(`Run ${runNumber} of ${month} has a damaged run-info.json, so it is not overwritten.`);
  }
}

/** An extra file of a run (such as summary.json), written before run-info.json. */
export type ExtraRunFile = { name: string; data: unknown; schema: z.ZodType };

/** Save a run. Refuses to touch a Final run. run-info.json goes last. */
export async function writeRun(ws: Workspace, bundle: RunBundle, extras: readonly ExtraRunFile[] = []): Promise<void> {
  const { month, runNumber } = bundle.info;
  await assertWritable(ws, month, runNumber);
  for (const extra of extras) await ws.writeJson(file(month, runNumber, extra.name), extra.data, extra.schema);
  await ws.writeJson(file(month, runNumber, RUN_FILES.facts), bundle.facts, FactsFileSchema);
  await ws.writeJson(file(month, runNumber, RUN_FILES.costs), bundle.costs, CostsFileSchema);
  await ws.writeJson(file(month, runNumber, RUN_FILES.checks), bundle.checks, ChecksFileSchema);
  await ws.writeJson(file(month, runNumber, RUN_FILES.settingsUsed), bundle.settingsUsed, SettingsUsedFileSchema);
  await ws.writeJson(file(month, runNumber, RUN_FILES.info), bundle.info, RunInfoSchema);
}

/** Make a saved Draft run Final: the checks (with their notes) are saved, then the status flips. */
export async function finalizeRun(
  ws: Workspace,
  month: string,
  runNumber: number,
  checks: readonly CheckResult[],
  now: Date = new Date(),
): Promise<RunInfoFile> {
  const info = await readInfo(ws, month, runNumber);
  if (!info) throw new Error(`Run ${runNumber} of ${month} has not been saved yet.`);
  if (info.status === 'Final') throw new FinalRunError(`Run ${runNumber} of ${month} is already Final.`);

  const checksFile: ChecksFile = { version: SCHEMA_VERSION, month, runNumber, checks: [...checks] };
  await ws.writeJson(file(month, runNumber, RUN_FILES.checks), checksFile, ChecksFileSchema);
  const final: RunInfoFile = { ...info, status: 'Final', finalizedAt: now.toISOString() };
  await ws.writeJson(file(month, runNumber, RUN_FILES.info), final, RunInfoSchema);
  return final;
}

/** Read every file of a saved run, validated. */
export async function readRun(ws: Workspace, month: string, runNumber: number): Promise<RunBundle> {
  const need = async <T>(name: string, read: () => Promise<T | null>): Promise<T> => {
    const value = await read();
    if (value === null) throw new Error(`${file(month, runNumber, name)} is missing.`);
    return value;
  };
  return {
    info: await need(RUN_FILES.info, () => readInfo(ws, month, runNumber)),
    facts: await need(RUN_FILES.facts, () => ws.readJson(file(month, runNumber, RUN_FILES.facts), FactsFileSchema)),
    costs: await need(RUN_FILES.costs, () => ws.readJson(file(month, runNumber, RUN_FILES.costs), CostsFileSchema)),
    checks: await need(RUN_FILES.checks, () => ws.readJson(file(month, runNumber, RUN_FILES.checks), ChecksFileSchema)),
    settingsUsed: await need(RUN_FILES.settingsUsed, () => ws.readJson(file(month, runNumber, RUN_FILES.settingsUsed), SettingsUsedFileSchema)),
  };
}

/** The newest Final run of a month, or null. */
export async function latestFinalRun(ws: Workspace, month: string): Promise<number | null> {
  const runs = await listRuns(ws, month);
  const final = runs.filter((r) => r.info?.status === 'Final').map((r) => r.runNumber);
  return final.length > 0 ? Math.max(...final) : null;
}

/** Facts of the most recent Final month before `month`, for the change check. */
export async function findPreviousFinal(ws: Workspace, month: string): Promise<{ month: string; facts: FactRow[] } | null> {
  const months = (await ws.listDirs(paths.data)).filter(isMonthDirName).filter((m) => m < month).sort().reverse();
  for (const m of months) {
    const n = await latestFinalRun(ws, m);
    if (n === null) continue;
    const facts = await ws.readJson(file(m, n, RUN_FILES.facts), FactsFileSchema);
    if (facts) return { month: m, facts: facts.facts };
  }
  return null;
}
