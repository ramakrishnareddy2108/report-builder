// The made-up month (see monthData.ts) as in-memory files, with matching settings.

import { loadDefaultRules } from '@/core/defaults';
import type { RunSettings } from '@/core/runMonth';
import { DEFAULT_SOURCE_MAPPINGS } from '@/core/sourceDefaults';
import type { DoctorMaster, SourceId } from '@/core/types';
import { MONTH_DATA } from './monthData';
import { hisFile } from './syntheticWorkbook';

export const MONTH = '2026-10';
export const DR_A = 'a-kumar';
export const DR_B = 'b-rao';

export const DOCTORS: DoctorMaster[] = [
  { id: DR_A, displayName: 'A Kumar', department: 'Cardiology', aliases: ['Dr. A Kumar'] },
  { id: DR_B, displayName: 'B Rao', department: 'Urology', aliases: [] },
];

export function monthSettings(overrides: { flags?: Partial<RunSettings['rules']['flags']> } = {}): RunSettings {
  const rules = loadDefaultRules();
  rules.flags = { ...rules.flags, ...overrides.flags };
  return {
    sources: { version: 1, sources: DEFAULT_SOURCE_MAPPINGS.map((m) => structuredClone(m)) },
    doctors: { version: 1, doctors: structuredClone(DOCTORS), departments: [], sponsors: [] },
    rules,
  };
}

/** The 8 source files of the made-up month, built in memory. */
export function monthFiles(): Record<SourceId, File> {
  return Object.fromEntries(
    (Object.entries(MONTH_DATA) as [SourceId, (typeof MONTH_DATA)[SourceId]][]).map(([id, s]) => [id, hisFile(s.fileName, s.header, s.rows, s.sheet)]),
  ) as Record<SourceId, File>;
}

export function monthRequest(settings = monthSettings()) {
  const files = monthFiles();
  return {
    month: MONTH,
    settings,
    files: (Object.keys(files) as SourceId[]).map((sourceId) => ({ sourceId, file: files[sourceId] })),
  };
}
