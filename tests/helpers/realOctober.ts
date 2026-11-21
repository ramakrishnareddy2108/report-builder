// The real October 2026 exports through the whole pipeline (git-ignored samples/).
// Only for the golden tests, which skip when samples/ is missing.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDefaultRules } from '@/core/defaults';
import { acceptSuggestions, suggestDoctors } from '@/core/doctors';
import type { RunOutput, RunSettings } from '@/core/runMonth';
import { DEFAULT_SOURCE_MAPPINGS } from '@/core/sourceDefaults';
import type { SourceId } from '@/core/types';
import { collectNamesTask } from '@/worker/tasks/collectNames';
import { readFileTask } from '@/worker/tasks/readFile';
import { runMonthTask } from '@/worker/tasks/runMonth';

export const SAMPLES_DIR = 'samples/2026-10';
export const samplesPresent = existsSync(SAMPLES_DIR);

export async function loadOctoberFiles(): Promise<{ sourceId: SourceId; file: File }[]> {
  const out: { sourceId: SourceId; file: File }[] = [];
  for (const name of readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.xlsx') && !/sponsor-wise|drr format/i.test(f))) {
    const file = new File([readFileSync(join(SAMPLES_DIR, name))], name);
    const { identification } = await readFileTask({ file, headersOnly: true });
    out.push({ sourceId: identification.sourceId as SourceId, file });
  }
  return out;
}

/** Default mappings and rules, with every suggested doctor accepted, as a user would on the Doctors page. */
export async function runOctober(): Promise<{ run: RunOutput; settings: RunSettings; files: { sourceId: SourceId; file: File }[] }> {
  const files = await loadOctoberFiles();
  const base: RunSettings = {
    sources: { version: 1, sources: DEFAULT_SOURCE_MAPPINGS.map((m) => structuredClone(m)) },
    doctors: { version: 1, doctors: [], departments: [], sponsors: [] },
    rules: loadDefaultRules(),
  };
  const names = await collectNamesTask({
    sources: files
      .map((f) => ({ ...f, mapping: base.sources.sources.find((m) => m.sourceId === f.sourceId)!, required: [] as never[] }))
      .filter((s) => s.mapping.fields.doctor),
  });
  const settings: RunSettings = { ...base, doctors: { ...base.doctors, doctors: acceptSuggestions([], suggestDoctors(names.doctors, [])) } };
  return { run: await runMonthTask({ month: '2026-10', files, settings }), settings, files };
}
