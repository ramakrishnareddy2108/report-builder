// The committed made-up Excel files (tests/fixtures/synthetic/, written by
// scripts/make-fixtures.ts) through the whole pipeline, asserting the Checks.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runChecks } from '@/core/checks';
import { findDuplicateFiles } from '@/core/runMonth';
import type { CheckResult, SourceId } from '@/core/types';
import { sha256Hex } from '@/excel/fingerprint';
import { readFileTask } from '@/worker/tasks/readFile';
import { runMonthTask } from '@/worker/tasks/runMonth';
import { DOCTORS, DR_A, MONTH, monthSettings } from '../helpers/monthFixture';

const ROOT = 'tests/fixtures/synthetic';

type Loaded = { sourceId: SourceId; file: File; sha256: string };

/** The files of a folder, identified as the Run page does (by name and headers). */
async function loadDir(dir: string): Promise<Loaded[]> {
  const out: Loaded[] = [];
  for (const name of readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.xlsx')).sort()) {
    const bytes = readFileSync(join(ROOT, dir, name));
    const file = new File([bytes], name);
    const { identification } = await readFileTask({ file, headersOnly: true });
    out.push({ sourceId: identification.sourceId as SourceId, file, sha256: await sha256Hex(new Uint8Array(bytes)) });
  }
  return out;
}

/** base/ with the files of a scenario folder put over it (same source = replaced). */
async function scenario(dir?: string): Promise<{ used: Loaded[]; all: Loaded[] }> {
  const base = await loadDir('base');
  if (!dir) return { used: base, all: base };
  const extra = await loadDir(dir);
  const replaced = new Set(extra.map((f) => f.sourceId));
  const used = [...base.filter((f) => !replaced.has(f.sourceId)), ...extra.slice(0, 1)];
  // Every loaded file counts for duplicates, even when two are assigned to one source.
  const all = dir === 'same-file-twice' ? [...base, ...extra] : used;
  return { used: dir === 'same-file-twice' ? base : used, all };
}

async function check(dir?: string) {
  const { used, all } = await scenario(dir);
  const settings = monthSettings();
  const run = await runMonthTask({ month: MONTH, settings, files: used.map(({ sourceId, file }) => ({ sourceId, file })) });
  const checks = runChecks({
    month: MONTH,
    rules: settings.rules,
    doctors: DOCTORS,
    diagnostics: run.diagnostics,
    facts: run.facts,
    costs: [{ doctorId: DR_A, amounts: { SALARY: 1 } }],
    previous: null,
    duplicateLoadedFiles: findDuplicateFiles(all.map((f) => ({ sourceId: f.sourceId, fileName: f.file.name, sha256: f.sha256 }))),
  });
  const get = (id: string): CheckResult => checks.find((c) => c.id === id) as CheckResult;
  return { run, checks, get, levels: Object.fromEntries(checks.map((c) => [c.id, c.level])) };
}

describe('synthetic month: base', () => {
  it('has 8 files that are each identified as their own source', async () => {
    const { all } = await scenario();
    expect(all.map((f) => f.sourceId).sort()).toEqual(
      ['ipAdmissions', 'ipBillBreakups', 'ipDischarge', 'ipGeneralBill', 'opBilling', 'opConsultations', 'opPharmacySales', 'opReturns'],
    );
  });

  it('gives exactly the expected Fails and Warnings', async () => {
    const { levels } = await check();
    const notPass = Object.entries(levels).filter(([, level]) => level !== 'Pass');
    expect(notPass).toEqual([
      ['unreadable-amounts', 'Fail'], //          G3 has the amount "abc"
      ['unknown-doctors', 'Warning'], //          "Dr Unknown"
      ['pharmacy-attribution', 'Warning'], //     two Fallback rows and one Unattributed row
      ['dates-outside-month', 'Warning'], //      G4 is dated 5 Nov
    ]);
  });

  it('flags the unreadable amount with its row, and still counts the rest of the file', async () => {
    const { get, run } = await check();
    expect(get('unreadable-amounts').examples).toEqual([{ sourceFile: 'IP General Bill Breakup Oct2026.xlsx', sourceRow: 6, ref: 'G3' }]);
    expect(run.facts.filter((f) => f.sourceId === 'ipGeneralBill' && f.measure === 'IP_REVENUE')).toHaveLength(3); // G1, G2, G4
  });

  it('reports the unknown doctor, the OP return, the in-patient pharmacy line and the patient with two consultations', async () => {
    const { get, run } = await check();
    expect(get('unknown-doctors').details).toEqual(['Dr Unknown: 1 row in IP Discharge']);
    expect(run.facts.find((f) => f.ref === 'R1')).toMatchObject({ measure: 'OP_PHARMACY', amountPaise: -3000, doctorId: DR_A });
    expect(get('ip-via-op-pharmacy')).toMatchObject({ level: 'Pass', rows: 2 }); // S5 and the R2 return
    expect(run.facts.filter((f) => f.ref === 'S3' && f.measure === 'OP_PHARMACY')[0]).toMatchObject({ attributionStatus: 'Fallback', doctorId: DR_A });
    expect(get('pharmacy-attribution').rows).toBe(3);
  });

  it('has no duplicates and file totals that agree', async () => {
    const { levels } = await check();
    expect(levels['duplicate-refs']).toBe('Pass');
    expect(levels['duplicate-files']).toBe('Pass');
    expect(levels['source-totals']).toBe('Pass');
    expect(levels['report-ties-to-sources']).toBe('Pass');
  });
});

describe('synthetic month: duplicate bill', () => {
  it('Fails on the repeated bill number (and the file total no longer matches its rows)', async () => {
    const { get } = await check('duplicate-bill');
    expect(get('duplicate-refs')).toMatchObject({ level: 'Fail', rows: 2 });
    expect(get('duplicate-refs').details?.[0]).toMatch(/OP Billing: 2 rows.*B1 on rows 4 and 5/);
    expect(get('source-totals').level).toBe('Fail'); // the file says 650.50, its rows now add up to 1,050.50
  });
});

describe('synthetic month: renamed column', () => {
  it('flags OP Billing, names the missing column, and reads nothing from it', async () => {
    const { get, run } = await check('renamed-column');
    expect(get('sources-fit-mapping').level).toBe('Fail');
    expect(get('sources-fit-mapping').details?.[0]).toMatch(/OP Billing: “NETAMOUNT” was not found/);
    expect(run.diagnostics.sources.find((s) => s.sourceId === 'opBilling')).toMatchObject({ status: 'flagged', rowsMapped: 0 });
    expect(run.facts.some((f) => f.sourceId === 'opBilling')).toBe(false);
  });
});

describe('synthetic month: same file twice', () => {
  it('Fails when an identical file is loaded a second time', async () => {
    const { get } = await check('same-file-twice');
    expect(get('duplicate-files')).toMatchObject({ level: 'Fail' });
    expect(get('duplicate-files').message).toMatch(/“OP Billing Report Oct2026.xlsx” and “OP Billing Report Oct2026 \(1\).xlsx”/);
  });

  it('Fails when the same file is used for two sources', async () => {
    const { used } = await scenario();
    const billing = used.find((f) => f.sourceId === 'opBilling')!;
    const files = used.map(({ sourceId, file }) => ({ sourceId, file: sourceId === 'opReturns' ? billing.file : file }));
    const run = await runMonthTask({ month: MONTH, settings: monthSettings(), files });
    expect(run.diagnostics.duplicateFiles).toHaveLength(1);
    expect(run.diagnostics.duplicateFiles[0]?.sourceIds.sort()).toEqual(['opBilling', 'opReturns']);
  });
});
