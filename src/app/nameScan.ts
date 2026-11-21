// Scanning the loaded files for doctor, department and sponsor names (in the worker).
// The result lives in memory for the session: names and counts only.

import { create } from 'zustand';
import { requiredFields } from '@/core/rules';
import { collectNamesInWorker } from '@/worker/client';
import type { TaskProgress } from '@/worker/protocol';
import type { CollectNamesResult } from '@/worker/tasks/collectNames';
import type { SourceInput } from '@/worker/tasks/readSource';
import { useFiles, fileForSource } from './filesStore';
import { useSettings } from './settingsStore';
import { SOURCE_IDS } from '@/core/types';

type ScanState = {
  status: 'idle' | 'scanning' | 'done' | 'error';
  progress: TaskProgress | null;
  result: CollectNamesResult | null;
  error: string | null;
  /** Sources that have a loaded file but no saved mapping, so they were not scanned. */
  unconfirmed: string[];
};

export const useNameScan = create<ScanState>()(() => ({
  status: 'idle',
  progress: null,
  result: null,
  error: null,
  unconfirmed: [],
}));

/** Scan every loaded file whose source has a saved (confirmed) mapping. */
export async function scanNames(): Promise<void> {
  const { sources, rules } = useSettings.getState();
  const { files } = useFiles.getState();

  const inputs: SourceInput[] = [];
  const unconfirmed: string[] = [];
  for (const sourceId of SOURCE_IDS) {
    const loaded = fileForSource(files, sourceId);
    if (!loaded) continue;
    const mapping = sources.sources.find((m) => m.sourceId === sourceId);
    if (!mapping) unconfirmed.push(sourceId);
    else inputs.push({ sourceId, file: loaded.file, mapping, required: [...requiredFields(rules, sourceId)] });
  }

  useNameScan.setState({ status: 'scanning', progress: null, error: null, unconfirmed });
  try {
    const result = await collectNamesInWorker({ sources: inputs }, (progress) => useNameScan.setState({ progress }));
    useNameScan.setState({ status: 'done', result, progress: null });
  } catch (err) {
    useNameScan.setState({ status: 'error', error: err instanceof Error ? err.message : String(err), progress: null });
  }
}
