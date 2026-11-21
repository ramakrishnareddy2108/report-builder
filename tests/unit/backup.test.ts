import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { loadDefaultRules } from '@/core/defaults';
import { RulesFileSchema } from '@/core/schemas';
import { applyRestore, backupFileName, createBackup, MANIFEST_NAME, planRestore, type RestorePlan } from '@/storage/backup';
import { paths, toJsonText, Workspace } from '@/storage/workspace';
import { runInfo } from '../helpers/fixtures';
import { MemoryDir } from '../helpers/memoryFs';

const AT = new Date(2026, 10, 21, 9, 5); // local time

async function seededWorkspace(name = 'Source') {
  const root = new MemoryDir(name);
  const ws = new Workspace(root);
  await ws.ensureLayout();
  await ws.writeJson('data/2026-10/run-1/run-info.json', runInfo('2026-10', 1, 'Final'));
  await ws.writeJson('data/2026-09/run-1/run-info.json', runInfo('2026-09', 1, 'Draft'));
  await ws.writeFile(paths.drrTemplate, new Uint8Array([0x50, 0x4b, 3, 4]));
  await ws.writeFile('output/2026-10/DRR.xlsx', new Uint8Array([9]));
  await ws.writeFile('settings/sources.json.tmp', '{}'); // stray temp file
  return { root, ws };
}

function ok(plan: RestorePlan): Extract<RestorePlan, { ok: true }> {
  if (!plan.ok) throw new Error(`Expected ok plan, got: ${plan.errors.join('; ')}`);
  return plan;
}

function errors(plan: RestorePlan): string[] {
  if (plan.ok) throw new Error('Expected plan to fail');
  return plan.errors;
}

/** Build a zip by hand. The manifest lists `files` keys unless `listed` is given. */
async function makeZip(files: Record<string, string | Uint8Array>, opts: { listed?: string[]; manifest?: unknown } = {}) {
  const zip = new JSZip();
  for (const [p, data] of Object.entries(files)) zip.file(p, data);
  const manifest = 'manifest' in opts ? opts.manifest : {
    version: 1,
    app: 'drr-report-builder',
    createdAt: '2026-11-21T09:05:00.000Z',
    workspaceName: 'Hand made',
    files: opts.listed ?? Object.keys(files),
  };
  if (manifest !== null) zip.file(MANIFEST_NAME, JSON.stringify(manifest));
  return zip.generateAsync({ type: 'uint8array' });
}

describe('backupFileName', () => {
  it('uses local date and time, zero-padded', () => {
    expect(backupFileName(AT)).toBe('backup-20261121-0905.zip');
    expect(backupFileName(new Date(2027, 0, 2, 23, 59))).toBe('backup-20270102-2359.zip');
  });
});

describe('createBackup', () => {
  it('zips settings/ and data/ with a manifest, but not output/ or temp files', async () => {
    const { ws } = await seededWorkspace();
    const result = await createBackup(ws, AT);

    expect(result.fileName).toBe('backup-20261121-0905.zip');
    const zip = await JSZip.loadAsync(result.data);
    const names = Object.values(zip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name)
      .sort();
    // Listed in backup order: settings/ first, then data/.
    const expected = [
      'settings/rules.json',
      'settings/templates/DRR Format.xlsx',
      'data/2026-09/run-1/run-info.json',
      'data/2026-10/run-1/run-info.json',
    ];
    expect(names).toEqual([MANIFEST_NAME, ...expected].sort());
    expect(result.fileCount).toBe(4);

    const manifest = JSON.parse(await zip.file(MANIFEST_NAME)!.async('string'));
    expect(manifest).toMatchObject({ app: 'drr-report-builder', workspaceName: 'Source', files: expected });
    expect(manifest.createdAt).toBe(AT.toISOString());
  });
});

describe('restore', () => {
  it('round-trips a backup into an empty workspace', async () => {
    const { root: src, ws } = await seededWorkspace();
    const { data } = await createBackup(ws, AT);

    const dest = new MemoryDir('Dest');
    const destWs = new Workspace(dest);
    const plan = ok(await planRestore(destWs, data));

    expect(plan.counts).toEqual({ add: 4, replace: 0, unchanged: 0 });
    expect(plan.months).toEqual(['2026-10', '2026-09']);
    expect(plan.workspaceName).toBe('Source');
    expect(dest.allPaths()).toEqual([]); // planning writes nothing

    expect(await applyRestore(destWs, plan)).toBe(4);
    const backedUp = src.allPaths().filter((p) => /^(settings|data)\//.test(p) && !p.endsWith('.tmp'));
    expect(dest.allPaths()).toEqual(backedUp);
    expect(await destWs.readJson(paths.rules, RulesFileSchema)).toEqual(loadDefaultRules());
    const tpl = await destWs.readFile(paths.drrTemplate);
    expect([...new Uint8Array(await tpl!.arrayBuffer())]).toEqual([0x50, 0x4b, 3, 4]);
  });

  it('marks unchanged and replaced files, and flags replacing a Final run', async () => {
    const { ws } = await seededWorkspace();
    const { data } = await createBackup(ws, AT);

    expect(ok(await planRestore(ws, data)).counts).toEqual({ add: 0, replace: 0, unchanged: 4 });

    // Change the workspace after the backup.
    const rules = loadDefaultRules();
    rules.flags.includeConsultations = !rules.flags.includeConsultations;
    await ws.writeJson(paths.rules, rules);
    await ws.writeJson('data/2026-10/run-1/run-info.json', { ...runInfo('2026-10', 1, 'Final'), operatorName: 'Changed' });
    await ws.writeJson('data/2026-09/run-1/run-info.json', { ...runInfo('2026-09', 1, 'Draft'), operatorName: 'Changed' });
    await ws.writeFile('data/2026-11/run-1/facts.json', 'kept'); // not in backup

    const plan = ok(await planRestore(ws, data));
    expect(plan.counts).toEqual({ add: 0, replace: 3, unchanged: 1 });
    const replaced = plan.items.filter((i) => i.action === 'replace').map((i) => [i.path, i.touchesFinalRun]);
    expect(replaced).toEqual([
      ['data/2026-09/run-1/run-info.json', false],
      ['data/2026-10/run-1/run-info.json', true],
      ['settings/rules.json', false],
    ]);

    expect(await applyRestore(ws, plan)).toBe(3);
    expect(await ws.readJson(paths.rules, RulesFileSchema)).toEqual(loadDefaultRules());
    expect(await (await ws.readFile('data/2026-11/run-1/facts.json'))?.text()).toBe('kept');
  });

  it('rejects a file that is not a zip', async () => {
    const { ws } = await seededWorkspace();
    expect(errors(await planRestore(ws, new TextEncoder().encode('hello')))).toEqual([
      'This file is not a zip file, or it is damaged.',
    ]);
  });

  it('rejects a zip without the manifest', async () => {
    const { ws } = await seededWorkspace();
    const zip = await makeZip({ [paths.rules]: toJsonText(loadDefaultRules()) }, { manifest: null });
    expect(errors(await planRestore(ws, zip))[0]).toMatch(/no backup-info\.json/);
  });

  it('rejects a manifest from another app', async () => {
    const { ws } = await seededWorkspace();
    const zip = await makeZip({}, { manifest: { version: 1, app: 'other', createdAt: 'x', workspaceName: '', files: [] } });
    expect(errors(await planRestore(ws, zip))[0]).toMatch(/backup-info\.json has problems/);
  });

  it('validates every JSON file with its schema and writes nothing on failure', async () => {
    const root = new MemoryDir('W');
    const ws = new Workspace(root);
    const zip = await makeZip({
      [paths.rules]: toJsonText(loadDefaultRules()),
      [paths.doctors]: '{"version":1,"doctors":[{"id":"d1"}]}',
      [paths.sources]: 'not json',
      'data/2026-10/run-1/run-info.json': toJsonText(runInfo('2026-09', 1, 'Draft')),
      'data/2026-10/run-2/run-info.json': toJsonText(runInfo('2026-10', 1, 'Draft')),
    });
    const errs = errors(await planRestore(ws, zip));
    expect(errs).toHaveLength(4);
    expect(errs.join('\n')).toMatch(/settings\/doctors\.json has problems/);
    expect(errs.join('\n')).toMatch(/settings\/sources\.json is not valid JSON/);
    expect(errs.join('\n')).toMatch(/says month 2026-09, but it is in the 2026-10 folder/);
    expect(errs.join('\n')).toMatch(/says run 1, but it is in the run-2 folder/);
    expect(root.allPaths()).toEqual([]);
  });

  it('rejects files outside settings/ and data/, unknown JSON, and unexpected file types', async () => {
    const { ws } = await seededWorkspace();
    const zip = await makeZip({
      'output/2026-10/DRR.xlsx': new Uint8Array([1]),
      'settings/notes.json': '{}',
      'data/2026-10/run-1/facts.csv': 'a,b',
      'settings/templates/DRR Format.xlsx': new Uint8Array([1]), // allowed
      'settings/rules.json.tmp': '{}',
    });
    const errs = errors(await planRestore(ws, zip));
    expect(errs).toEqual([
      'output/2026-10/DRR.xlsx is outside settings/ and data/.',
      'settings/notes.json is not a file this app knows how to check.',
      'data/2026-10/run-1/facts.csv is not a file this app expects in a backup.',
      'settings/rules.json.tmp is a temporary file.',
    ]);
  });

  it('rejects names that only differ by case', async () => {
    const { ws } = await seededWorkspace();
    const tpl = new Uint8Array([1]);
    const zip = await makeZip({ 'settings/templates/a.xlsx': tpl, 'settings/templates/A.xlsx': tpl });
    expect(errors(await planRestore(ws, zip))[0]).toMatch(/would overwrite each other/);
  });

  it('rejects a zip whose contents do not match the manifest list', async () => {
    const { ws } = await seededWorkspace();
    const zip = await makeZip(
      { [paths.rules]: toJsonText(loadDefaultRules()) },
      { listed: [paths.rules, paths.doctors] },
    );
    expect(errors(await planRestore(ws, zip))).toEqual([
      'settings/doctors.json is listed in the backup but missing from the zip.',
    ]);
  });
});
