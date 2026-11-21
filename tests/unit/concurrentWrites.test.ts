import { describe, expect, it } from 'vitest';
import { Workspace } from '@/storage/workspace';
import { MemoryDir } from '../helpers/memoryFs';

describe('two writes to the same file at once', () => {
  it('both succeed, one after the other, and the last one wins', async () => {
    const root = new MemoryDir('ws');
    const ws = new Workspace(root);
    await Promise.all([
      ws.writeJson('settings/dashboards.json', { version: 1, dashboards: [] }),
      ws.writeJson('settings/dashboards.json', { version: 1, dashboards: [{ id: 'second' }] }),
    ]);
    expect(JSON.parse((await (await ws.readFile('settings/dashboards.json'))?.text()) ?? '')).toEqual({ version: 1, dashboards: [{ id: 'second' }] });
    // Each write used the temp file in turn; none overlapped, and no temp file is left.
    expect(root.log).toEqual([
      'write dashboards.json.tmp',
      'rename dashboards.json.tmp -> dashboards.json',
      'write dashboards.json.tmp',
      'rename dashboards.json.tmp -> dashboards.json',
    ]);
    expect(root.allPaths()).toEqual(['settings/dashboards.json']);
  });

  it('a failed write does not block the next one', async () => {
    const ws = new Workspace(new MemoryDir('ws'));
    const bad = ws.writeText('data/../x.json', '{}'); // an invalid path fails
    await expect(bad).rejects.toThrow();
    await expect(ws.writeText('settings/a.json', '{}')).resolves.toBeUndefined();
  });

  it('different files are written independently', async () => {
    const ws = new Workspace(new MemoryDir('ws'));
    await Promise.all([ws.writeText('settings/a.json', '1'), ws.writeText('settings/b.json', '2')]);
    expect(await (await ws.readFile('settings/a.json'))?.text()).toBe('1');
    expect(await (await ws.readFile('settings/b.json'))?.text()).toBe('2');
  });
});
