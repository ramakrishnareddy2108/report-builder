// The real October 2026 exports through the whole pipeline (git-ignored samples/).
// Only for the golden tests, which skip when samples/ is missing.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDefaultRules } from '@/core/defaults';
import { DoctorMatcher, acceptSuggestions, suggestDoctors } from '@/core/doctors';
import { toPaise } from '@/core/money';
import { RulesFileSchema } from '@/core/schemas';
import type { RunOutput, RunSettings } from '@/core/runMonth';
import { DEFAULT_SOURCE_MAPPINGS } from '@/core/sourceDefaults';
import { COST_MEASURE_CODES, type CostEntry, type CostMeasureCode, type SourceId } from '@/core/types';
import { collectNamesTask } from '@/worker/tasks/collectNames';
import { readFileTask } from '@/worker/tasks/readFile';
import { runMonthTask } from '@/worker/tasks/runMonth';

export const SAMPLES_DIR = 'samples/2026-10';
export const samplesPresent = existsSync(SAMPLES_DIR);

if (!samplesPresent) {
  console.info(
    `Golden tests skipped: ${SAMPLES_DIR}/ is missing (it holds real hospital files and is never committed). They run on a laptop that has the samples.`,
  );
}

/**
 * Optional local settings for the golden run (tests/golden/settings.local.json, git-ignored):
 *   { "flags": { "includePendingIpBills": true, "includeConsultations": false },
 *     "rules": [ ...a full replacement of the measure rules... ],
 *     "costs": { "<doctor name>": { "DEPT_ISSUES": 0, "SALARY": 0, "INCENTIVES": 0, "PROF_FEE": 0 } } }   // rupees
 */
export const LOCAL_SETTINGS = 'tests/golden/settings.local.json';

type LocalSettings = {
  flags?: Partial<RunSettings['rules']['flags']>;
  rules?: unknown[];
  costs?: Record<string, Partial<Record<CostMeasureCode, number>>>;
};

function readLocalSettings(): LocalSettings {
  return existsSync(LOCAL_SETTINGS) ? (JSON.parse(readFileSync(LOCAL_SETTINGS, 'utf8')) as LocalSettings) : {};
}

export async function loadOctoberFiles(): Promise<{ sourceId: SourceId; file: File }[]> {
  const out: { sourceId: SourceId; file: File }[] = [];
  for (const name of readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.xlsx') && !/sponsor-wise|drr format/i.test(f))) {
    const file = new File([readFileSync(join(SAMPLES_DIR, name))], name);
    const { identification } = await readFileTask({ file, headersOnly: true });
    out.push({ sourceId: identification.sourceId as SourceId, file });
  }
  return out;
}

type OctoberRun = { run: RunOutput; settings: RunSettings; costs: CostEntry[]; files: { sourceId: SourceId; file: File }[] };

/**
 * Default mappings and rules (plus tests/golden/settings.local.json, if present), with every
 * suggested doctor accepted as a user would on the Doctors page.
 */
export async function runOctober(): Promise<OctoberRun> {
  const files = await loadOctoberFiles();
  const local = readLocalSettings();
  const defaults = loadDefaultRules();
  const base: RunSettings = {
    sources: { version: 1, sources: DEFAULT_SOURCE_MAPPINGS.map((m) => structuredClone(m)) },
    doctors: { version: 1, doctors: [], departments: [], sponsors: [] },
    rules: RulesFileSchema.parse({ ...defaults, ...(local.rules ? { rules: local.rules } : {}), flags: { ...defaults.flags, ...local.flags } }),
  };
  const names = await collectNamesTask({
    sources: files
      .map((f) => ({ ...f, mapping: base.sources.sources.find((m) => m.sourceId === f.sourceId)!, required: [] as never[] }))
      .filter((s) => s.mapping.fields.doctor),
  });
  const settings: RunSettings = { ...base, doctors: { ...base.doctors, doctors: acceptSuggestions([], suggestDoctors(names.doctors, [])) } };

  // Costs are typed in rupees by doctor name; they are matched through the doctor list like the Costs page import.
  const matcher = new DoctorMatcher(settings.doctors.doctors);
  const costs: CostEntry[] = Object.entries(local.costs ?? {}).map(([name, amounts]) => {
    const m = matcher.match(name);
    if (m.status !== 'matched') throw new Error(`settings.local.json: the doctor "${name}" is not in the doctor list`);
    const paise = Object.fromEntries(
      COST_MEASURE_CODES.flatMap((c) => (amounts[c] === undefined ? [] : [[c, toPaise(amounts[c]) as number]])),
    );
    return { doctorId: m.doctor.id, amounts: paise };
  });

  return { run: await runMonthTask({ month: '2026-10', files, settings }), settings, costs, files };
}
