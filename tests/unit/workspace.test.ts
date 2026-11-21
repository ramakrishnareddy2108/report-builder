import { describe, expect, it } from 'vitest';
import { loadDefaultRules } from '@/core/defaults';
import { RulesFileSchema, RunInfoSchema } from '@/core/schemas';
import {
  describeJsonPath,
  isMonthDirName,
  joinPath,
  LAYOUT_DIRS,
  parseRunDirName,
  paths,
  splitPath,
  Workspace,
  WorkspaceFileError,
  WorkspacePathError,
} from '@/storage/workspace';
import { runInfo } from '../helpers/fixtures';
import { MemoryDir } from '../helpers/memoryFs';

function newWorkspace() {
  const root = new MemoryDir('G2 DRR');
  return { root, ws: new Workspace(root) };
}

describe('paths', () => {
  it('splits valid workspace paths', () => {
    expect(splitPath('settings/rules.json')).toEqual(['settings', 'rules.json']);
    expect(splitPath('settings/templates/DRR Format.xlsx')).toEqual(['settings', 'templates', 'DRR Format.xlsx']);
  });

  it.each([
    ['/settings/rules.json'],
    ['settings//rules.json'],
    ['settings/'],
    [''],
    ['../secret.json'],
    ['data/./x.json'],
    ['settings\\rules.json'],
    ['data/a:b.json'],
    ['data/ x.json'],
    ['data/x.'],
  ])('rejects %j', (p) => {
    expect(() => splitPath(p)).toThrow(WorkspacePathError);
  });

  it('builds run and month paths', () => {
    expect(paths.run('2026-10', 2)).toBe('data/2026-10/run-2');
    expect(paths.month('2026-10')).toBe('data/2026-10');
    expect(paths.outputMonth('2026-10')).toBe('output/2026-10');
    expect(joinPath('a', '', 'b')).toBe('a/b');
  });

  it('parses run folder names', () => {
    expect(parseRunDirName('run-1')).toBe(1);
    expect(parseRunDirName('run-12')).toBe(12);
    expect(parseRunDirName('run-0')).toBeNull();
    expect(parseRunDirName('run-01')).toBeNull();
    expect(parseRunDirName('Run-1')).toBeNull();
    expect(parseRunDirName('run-1-copy')).toBeNull();
  });

  it('recognises month folder names', () => {
    expect(isMonthDirName('2026-10')).toBe(true);
    expect(isMonthDirName('2026-13')).toBe(false);
    expect(isMonthDirName('Oct 2026')).toBe(false);
  });

  it('knows which schema each JSON path uses', () => {
    expect(describeJsonPath('settings/rules.json')?.schema).toBe(RulesFileSchema);
    expect(describeJsonPath('data/2026-10/run-3/run-info.json')).toEqual({
      area: 'run',
      schema: RunInfoSchema,
      month: '2026-10',
      runNumber: 3,
    });
    expect(describeJsonPath('settings/other.json')).toBeNull();
    expect(describeJsonPath('data/2026-10/run-0/facts.json')).toBeNull();
    expect(describeJsonPath('data/2026-13/run-1/facts.json')).toBeNull();
    expect(describeJsonPath('data/2026-10/run-1/notes.json')).toBeNull();
    expect(describeJsonPath('data/2026-10/facts.json')).toBeNull();
    expect(describeJsonPath('output/2026-10/run-1/facts.json')).toBeNull();
  });
});

describe('ensureLayout', () => {
  it('creates the folders and seeds rules.json in an empty folder', async () => {
    const { root, ws } = newWorkspace();
    const created = await ws.ensureLayout();

    expect(created).toEqual([...LAYOUT_DIRS.map((d) => `${d}/`), paths.rules]);
    expect(root.allDirs()).toEqual(['data/', 'output/', 'settings/', 'settings/templates/']);
    expect(root.allPaths()).toEqual(['settings/rules.json']);
    expect(await ws.readJson(paths.rules, RulesFileSchema)).toEqual(loadDefaultRules());
  });

  it('is a no-op the second time and never overwrites existing files', async () => {
    const { ws } = newWorkspace();
    await ws.ensureLayout();
    const rules = loadDefaultRules();
    rules.flags.includeConsultations = !rules.flags.includeConsultations;
    await ws.writeJson(paths.rules, rules);

    expect(await ws.ensureLayout()).toEqual([]);
    expect(await ws.readJson(paths.rules, RulesFileSchema)).toEqual(rules);
  });

  it('leaves an existing (even broken) rules.json alone and only adds missing folders', async () => {
    const { root, ws } = newWorkspace();
    await ws.writeFile(paths.rules, '{ broken');
    const created = await ws.ensureLayout();

    expect(created).toEqual(['settings/templates/', 'data/', 'output/']);
    expect(await (await ws.readFile(paths.rules))?.text()).toBe('{ broken');
    expect(root.allPaths()).toEqual(['settings/rules.json']);
  });
});

describe('JSON helpers', () => {
  it('writes via a temp file then renames, leaving no temp file', async () => {
    const { root, ws } = newWorkspace();
    await ws.writeJson('settings/dashboards.json', { version: 1, dashboards: [] });

    expect(root.log).toEqual(['write dashboards.json.tmp', 'rename dashboards.json.tmp -> dashboards.json']);
    expect(root.allPaths()).toEqual(['settings/dashboards.json']);
    expect(await (await ws.readFile('settings/dashboards.json'))?.text()).toBe(
      '{\n  "version": 1,\n  "dashboards": []\n}\n',
    );
  });

  it('overwrites an existing file', async () => {
    const { ws } = newWorkspace();
    await ws.writeJson('settings/dashboards.json', { version: 1, dashboards: [] });
    await ws.writeJson('settings/dashboards.json', { version: 1, dashboards: [{ id: 'a', name: 'A' }] });
    expect(JSON.parse((await (await ws.readFile('settings/dashboards.json'))?.text()) ?? '')).toEqual({
      version: 1,
      dashboards: [{ id: 'a', name: 'A' }],
    });
  });

  it('refuses to write data that fails the schema', async () => {
    const { root, ws } = newWorkspace();
    await expect(ws.writeJson(paths.rules, { version: 1 }, RulesFileSchema)).rejects.toThrow(WorkspaceFileError);
    expect(root.allPaths()).toEqual([]);
  });

  it('readJson returns null for a missing file', async () => {
    const { ws } = newWorkspace();
    expect(await ws.readJson(paths.rules, RulesFileSchema)).toBeNull();
  });

  it('readJson explains invalid JSON and schema problems, naming the file', async () => {
    const { ws } = newWorkspace();
    await ws.writeFile(paths.rules, 'not json');
    await expect(ws.readJson(paths.rules, RulesFileSchema)).rejects.toThrow(/settings\/rules\.json is not valid JSON/);

    await ws.writeFile(paths.rules, JSON.stringify({ version: 1, flags: {}, rules: [] }));
    const err = await ws.readJson(paths.rules, RulesFileSchema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkspaceFileError);
    expect((err as WorkspaceFileError).path).toBe(paths.rules);
    expect((err as Error).message).toMatch(/settings\/rules\.json has problems/);
  });

  it('rejects bad paths before touching the folder', async () => {
    const { root, ws } = newWorkspace();
    await expect(ws.writeJson('../x.json', {})).rejects.toThrow(WorkspacePathError);
    expect(root.log).toEqual([]);
  });
});

describe('files and folders', () => {
  it('writeFile creates parent folders and readFile reads bytes back', async () => {
    const { ws } = newWorkspace();
    await ws.writeFile('output/2026-10/DRR.xlsx', new Uint8Array([1, 2, 3]));
    const blob = await ws.readFile('output/2026-10/DRR.xlsx');
    expect([...new Uint8Array(await blob!.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(await ws.readFile('output/2026-11/DRR.xlsx')).toBeNull();
  });

  it('lists folders and files, hiding temp files', async () => {
    const { ws } = newWorkspace();
    await ws.writeFile('data/2026-10/run-1/facts.json', '{}');
    await ws.writeFile('data/2026-10/run-1/facts.json.tmp', '{}');
    await ws.writeFile('data/2026-10/run-2/x.json', '{}');

    expect(await ws.listDirs('data/2026-10')).toEqual(['run-1', 'run-2']);
    expect(await ws.listDirs('data/2099-01')).toEqual([]);
    expect(await ws.listFiles('data/2026-10/run-1')).toEqual(['facts.json']);
    expect(await ws.listFilesDeep('data')).toEqual(['data/2026-10/run-1/facts.json', 'data/2026-10/run-2/x.json']);
    expect(await ws.listDirs('')).toEqual(['data']);
  });
});

describe('summary', () => {
  it('lists months newest first with run status, ignoring other folders', async () => {
    const { ws } = newWorkspace();
    await ws.ensureLayout();
    await ws.writeJson('data/2026-10/run-1/run-info.json', runInfo('2026-10', 1, 'Draft'));
    await ws.writeJson('data/2026-10/run-2/run-info.json', runInfo('2026-10', 2, 'Final'));
    await ws.writeFile('data/2026-10/run-3/facts.json', '{}'); // no run-info → Unknown
    await ws.writeFile('data/2026-10/run-4/run-info.json', '{ broken'); // unreadable → Unknown
    await ws.writeFile('data/2026-10/scratch/a.txt', 'x');
    await ws.writeJson('data/2026-09/run-1/run-info.json', runInfo('2026-09', 1, 'Final'));
    await ws.writeFile('data/notes/a.txt', 'x');

    const s = await ws.summary();
    expect(s.name).toBe('G2 DRR');
    expect(s.months).toEqual([
      {
        month: '2026-10',
        runs: [
          { runNumber: 1, status: 'Draft' },
          { runNumber: 2, status: 'Final' },
          { runNumber: 3, status: 'Unknown' },
          { runNumber: 4, status: 'Unknown' },
        ],
      },
      { month: '2026-09', runs: [{ runNumber: 1, status: 'Final' }] },
    ]);
  });

  it('reports settings files as present, missing or invalid', async () => {
    const { ws } = newWorkspace();
    await ws.ensureLayout();
    await ws.writeFile(paths.doctors, '{"version":1,"doctors":[{"id":""}]}');
    await ws.writeFile(paths.drrTemplate, new Uint8Array([0x50, 0x4b]));

    const byPath = Object.fromEntries((await ws.settingsStatus()).map((f) => [f.path, f.status]));
    expect(byPath).toEqual({
      [paths.sources]: 'missing',
      [paths.doctors]: 'invalid',
      [paths.rules]: 'ok',
      [paths.costsDefaults]: 'missing',
      [paths.dashboards]: 'missing',
      [paths.drrTemplate]: 'ok',
      [paths.sponsorTemplate]: 'missing',
    });
  });

  it('handles an empty, un-set-up folder', async () => {
    const { ws } = newWorkspace();
    const s = await ws.summary();
    expect(s.months).toEqual([]);
    expect(s.settings.every((f) => f.status === 'missing')).toBe(true);
  });
});
