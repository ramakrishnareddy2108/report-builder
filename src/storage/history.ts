// Reading saved months back as MonthData, and importing a past DRR as a summary month.

import { monthDataFromRun, monthDataFromSummary, type MonthData } from '@/core/history';
import { MEASURES } from '@/core/measures';
import {
  SCHEMA_VERSION,
  SummaryFileSchema,
  type RunInfoFile,
  type SettingsUsedFile,
  type SummaryFile,
} from '@/core/schemas';
import type { MeasureCode } from '@/core/types';
import { listRuns, readRun, writeRun, type RunSummary } from './runs';
import { isMonthDirName, joinPath, paths, type Workspace } from './workspace';

export const SUMMARY_FILE = 'summary.json';

/** Months already read, per workspace. A run's identity changes whenever it is saved again. */
const caches = new WeakMap<Workspace, Map<string, MonthData>>();

const cacheKey = (info: RunInfoFile) => `${info.month}/${info.runNumber}/${info.createdAt}/${info.status}/${info.finalizedAt ?? ''}`;

/** The run to use for a month: the newest Final run, else the newest run. */
export function bestRun(runs: readonly RunSummary[]): RunSummary | null {
  const usable = runs.filter((r) => r.info !== null);
  return [...usable].reverse().find((r) => r.info?.status === 'Final') ?? usable.at(-1) ?? null;
}

async function loadRunData(ws: Workspace, info: RunInfoFile): Promise<MonthData> {
  const key = cacheKey(info);
  let cache = caches.get(ws);
  if (!cache) caches.set(ws, (cache = new Map()));
  const hit = cache.get(key);
  if (hit) return hit;

  let data: MonthData;
  if (info.kind === 'summary') {
    const summary = await ws.readJson(joinPath(paths.run(info.month, info.runNumber), SUMMARY_FILE), SummaryFileSchema);
    if (!summary) throw new Error(`Run ${info.runNumber} of ${info.month} is an imported month but has no ${SUMMARY_FILE}.`);
    data = monthDataFromSummary({ runNumber: info.runNumber, status: info.status }, summary);
  } else {
    const run = await readRun(ws, info.month, info.runNumber);
    data = monthDataFromRun({
      month: info.month,
      runNumber: info.runNumber,
      status: info.status,
      facts: run.facts.facts,
      costs: run.costs.entries,
      doctors: run.settingsUsed.doctors.doctors,
      checks: run.checks.checks,
    });
  }
  cache.set(key, data);
  return data;
}

export type MonthOverview = {
  month: string;
  runs: RunSummary[];
  /** The newest run (shown in the Months table), whatever its status. */
  latest: RunSummary | null;
  /** The month's data from its newest run. */
  latestData: MonthData | null;
  /** The month's data from its best run (newest Final, else newest): what compare and trend use. */
  bestData: MonthData | null;
  /** Why the month could not be read, in plain language. */
  error?: string;
};

/** Every month in data/, newest first, with its totals. A month that cannot be read is listed with the reason. */
export async function listOverviews(ws: Workspace): Promise<MonthOverview[]> {
  const months = (await ws.listDirs(paths.data)).filter(isMonthDirName).sort().reverse();
  const out: MonthOverview[] = [];
  for (const month of months) {
    const runs = await listRuns(ws, month);
    const latest = runs.filter((r) => r.info !== null).at(-1) ?? null;
    const best = bestRun(runs);
    try {
      const latestData = latest?.info ? await loadRunData(ws, latest.info) : null;
      const bestData = best?.info ? (best.runNumber === latest?.runNumber ? latestData : await loadRunData(ws, best.info)) : null;
      out.push({ month, runs, latest, latestData, bestData });
    } catch (err) {
      out.push({ month, runs, latest, latestData: null, bestData: null, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

/** Data of one month from its best run, or null if it has no usable run. */
export async function loadBestMonth(ws: Workspace, month: string): Promise<MonthData | null> {
  const best = bestRun(await listRuns(ws, month));
  return best?.info ? loadRunData(ws, best.info) : null;
}

// ---------------------------------------------------------------------------
// Importing a past DRR as a summary month
// ---------------------------------------------------------------------------

export type SummaryRow = SummaryFile['rows'][number];

export class SummaryImportError extends Error {
  override name = 'SummaryImportError';
}

/**
 * Save a filled past DRR as a summary month: a Final run with no fact rows, so trends can start
 * earlier. Refuses a month that already has runs, so it can never stand in for a real run.
 */
export async function importSummaryMonth(
  ws: Workspace,
  input: { month: string; sourceFile: string; rows: readonly SummaryRow[]; operatorName: string; settings: SettingsUsedFile; now?: Date },
): Promise<void> {
  if (input.rows.length === 0) throw new SummaryImportError('The file has no rows to import.');
  if (input.operatorName.trim() === '') throw new SummaryImportError('Enter your name before importing, so the import can be traced.');
  if ((await listRuns(ws, input.month)).length > 0) {
    throw new SummaryImportError(`${input.month} already has a saved run. An imported month is only for months you never ran in this app.`);
  }

  const { month } = input;
  const runNumber = 1;
  const at = (input.now ?? new Date()).toISOString();
  const summary: SummaryFile = { version: SCHEMA_VERSION, month, runNumber, sourceFile: input.sourceFile, rows: input.rows.map((r) => ({ ...r })) };
  await writeRun(
    ws,
    {
      info: {
        version: SCHEMA_VERSION,
        month,
        runNumber,
        kind: 'summary',
        status: 'Final',
        createdAt: at,
        finalizedAt: at,
        operatorName: input.operatorName.trim(),
        reason: `Imported from ${input.sourceFile}`,
        files: [],
      },
      facts: { version: SCHEMA_VERSION, month, runNumber, facts: [] },
      costs: { version: SCHEMA_VERSION, month, operatorName: input.operatorName.trim(), updatedAt: at, entries: [] },
      checks: { version: SCHEMA_VERSION, month, runNumber, checks: [] },
      settingsUsed: input.settings,
    },
    [{ name: SUMMARY_FILE, data: summary, schema: SummaryFileSchema }],
  );
}

/** Rows of a read report as summary rows: every measure in whole paise (or count), blanks as 0. */
export function toSummaryRows(rows: readonly { name: string; department: string; values: Partial<Record<MeasureCode, number>> }[]): SummaryRow[] {
  return rows.map((r) => ({
    name: r.name,
    department: r.department,
    values: Object.fromEntries(MEASURES.filter((m) => m.kind !== 'calc').map((m) => [m.code, r.values[m.code] ?? 0])) as SummaryRow['values'],
  }));
}
