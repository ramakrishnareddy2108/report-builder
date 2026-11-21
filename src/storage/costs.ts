// Reading and writing the monthly costs in the workspace folder.

import { CostsFileSchema, RunInfoSchema, SCHEMA_VERSION, type CostsFile } from '@/core/schemas';
import type { CostEntry } from '@/core/types';
import { joinPath, paths, parseRunDirName, type Workspace } from './workspace';

/** The costs being entered for a month, or null if none were saved. */
export function readCostsDraft(ws: Workspace, month: string): Promise<CostsFile | null> {
  return ws.readJson(paths.costsDraft(month), CostsFileSchema);
}

export async function writeCostsDraft(
  ws: Workspace,
  input: { month: string; operatorName: string; entries: readonly CostEntry[]; now?: Date },
): Promise<CostsFile> {
  const file: CostsFile = {
    version: SCHEMA_VERSION,
    month: input.month,
    operatorName: input.operatorName,
    updatedAt: (input.now ?? new Date()).toISOString(),
    entries: [...input.entries],
  };
  await ws.writeJson(paths.costsDraft(input.month), file, CostsFileSchema);
  return file;
}

/**
 * The costs a saved run used for a month: the newest Final run, else the newest run.
 * Used to carry costs forward when no draft exists.
 */
export async function readLatestRunCosts(ws: Workspace, month: string): Promise<CostsFile | null> {
  const runs = (await ws.listDirs(paths.month(month)))
    .map(parseRunDirName)
    .filter((n): n is number => n !== null)
    .sort((a, b) => b - a);

  let newest: number | null = null;
  for (const n of runs) {
    const info = await ws.readJson(joinPath(paths.run(month, n), 'run-info.json'), RunInfoSchema).catch(() => null);
    if (info?.status === 'Final') return ws.readJson(joinPath(paths.run(month, n), 'costs.json'), CostsFileSchema);
    newest ??= n;
  }
  return newest === null ? null : ws.readJson(joinPath(paths.run(month, newest), 'costs.json'), CostsFileSchema);
}

/** The costs to copy forward from a month: its draft, else what its latest run used. */
export async function readCostsToCopy(ws: Workspace, month: string): Promise<CostsFile | null> {
  return (await readCostsDraft(ws, month)) ?? (await readLatestRunCosts(ws, month));
}
