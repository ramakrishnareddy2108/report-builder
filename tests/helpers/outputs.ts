// Everything a run can write out, as text, so a test can search it: the run files, a
// backup zip of the workspace, and the two Excel reports (their XML parts).

import JSZip from 'jszip';
import { runChecks } from '@/core/checks';
import { doctorReport, sponsorReport } from '@/core/report';
import type { RunOutput, RunSettings } from '@/core/runMonth';
import { SCHEMA_VERSION } from '@/core/schemas';
import type { CostEntry } from '@/core/types';
import { buildReport } from '@/excel/buildReport';
import { createBackup } from '@/storage/backup';
import { writeRun } from '@/storage/runs';
import { Workspace } from '@/storage/workspace';
import { MemoryDir } from './memoryFs';

export type OutputFile = { name: string; text: string };

async function zipTexts(prefix: string, bytes: Uint8Array): Promise<OutputFile[]> {
  const zip = await JSZip.loadAsync(bytes);
  const out: OutputFile[] = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/\.(json|xml|rels)$/i.test(entry.name)) continue;
    out.push({ name: `${prefix}/${entry.name}`, text: await entry.async('string') });
  }
  return out;
}

export async function allOutputs(input: {
  month: string;
  run: RunOutput;
  settings: RunSettings;
  costs: CostEntry[];
  drrTemplate: Uint8Array;
  sponsorTemplate: Uint8Array;
}): Promise<OutputFile[]> {
  const { month, run, settings, costs } = input;
  const checks = runChecks({ month, rules: settings.rules, doctors: settings.doctors.doctors, diagnostics: run.diagnostics, facts: run.facts, costs, previous: null });

  // The saved run, and a backup of the workspace holding it.
  const ws = new Workspace(new MemoryDir('ws'));
  await writeRun(ws, {
    info: { version: SCHEMA_VERSION, month, runNumber: 1, status: 'Draft', createdAt: '2026-11-02T10:00:00.000Z', operatorName: 'Test', reason: null, files: run.diagnostics.fingerprints },
    facts: { version: SCHEMA_VERSION, month, runNumber: 1, facts: run.facts },
    costs: { version: SCHEMA_VERSION, month, operatorName: 'Test', updatedAt: '2026-11-01T10:00:00.000Z', entries: costs },
    checks: { version: SCHEMA_VERSION, month, runNumber: 1, checks },
    settingsUsed: { version: SCHEMA_VERSION, sources: settings.sources, doctors: settings.doctors, rules: settings.rules, costsDefaults: null },
  });
  const files: OutputFile[] = [];
  for (const path of await ws.listFilesDeep('data')) files.push({ name: path, text: await (await ws.readFile(path))!.text() });
  files.push(...(await zipTexts('backup', (await createBackup(ws)).data)));

  // The two Excel reports.
  const doctors = settings.doctors.doctors;
  const names = new Map(doctors.map((d) => [d.id, d.displayName]));
  for (const [kind, template, rows] of [
    ['drr', input.drrTemplate, doctorReport(run.facts, costs, doctors, month)],
    ['sponsor', input.sponsorTemplate, sponsorReport(run.facts, month)],
  ] as const) {
    const built = await buildReport({ template, kind, rows, checks, facts: run.facts, doctorNames: names });
    files.push(...(await zipTexts(`report-${kind}`, built.bytes)));
  }
  return files;
}
