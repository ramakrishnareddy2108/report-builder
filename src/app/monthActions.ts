// Actions of the Months page: load the months, download a past run again, import a past DRR.

import { useCallback, useEffect, useState } from 'react';
import { SCHEMA_VERSION, type SettingsUsedFile } from '@/core/schemas';
import { importSummaryMonth, listOverviews, toSummaryRows, type MonthOverview } from '@/storage/history';
import { readRun } from '@/storage/runs';
import type { Workspace } from '@/storage/workspace';
import { readReportInWorker } from '@/worker/client';
import type { BuildReportsResult, ReadReportResult } from '@/worker/tasks/reports';
import { makeAndSaveReports } from './reportFiles';
import { useSettings } from './settingsStore';

/** Every saved month, newest first. Reload with `reload()` after changing something. */
export function useMonthOverviews(ws: Workspace): { overviews: MonthOverview[] | null; error: string | null; reload: () => Promise<void> } {
  const [overviews, setOverviews] = useState<MonthOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setOverviews(await listOverviews(ws));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [ws]);

  useEffect(() => {
    void reload();
  }, [reload]);
  return { overviews, error, reload };
}

/**
 * Make the two Excel reports of a saved run again, from that run's own facts, costs, checks and
 * doctor list (its settings-used.json), so the numbers are exactly what the run had. The templates
 * are the ones in the workspace now.
 */
export async function downloadRunAgain(ws: Workspace, month: string, runNumber: number): Promise<BuildReportsResult> {
  const run = await readRun(ws, month, runNumber);
  if (run.info.kind === 'summary') throw new Error('An imported month has no fact rows, so its reports cannot be made again.');
  return makeAndSaveReports(ws, {
    month,
    runNumber,
    facts: run.facts.facts,
    costs: run.costs.entries,
    doctors: run.settingsUsed.doctors.doctors,
    checks: run.checks.checks,
  });
}

/** Read a past DRR in the worker. */
export async function readPastDrr(file: File): Promise<ReadReportResult> {
  return readReportInWorker({ bytes: await file.arrayBuffer() });
}

/** Save a read DRR as a summary month, with a copy of the current settings. */
export async function importPastDrr(
  ws: Workspace,
  input: { month: string; fileName: string; read: Extract<ReadReportResult, { ok: true }>; operatorName: string },
): Promise<void> {
  const settings = useSettings.getState();
  const settingsUsed: SettingsUsedFile = {
    version: SCHEMA_VERSION,
    sources: settings.sources,
    doctors: settings.doctors,
    rules: settings.rules,
    costsDefaults: null,
  };
  await importSummaryMonth(ws, {
    month: input.month,
    sourceFile: input.fileName,
    rows: toSummaryRows(input.read.rows),
    operatorName: input.operatorName,
    settings: settingsUsed,
  });
}
