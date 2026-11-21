import { describe, expect, it } from 'vitest';
import { readCostsDraft, readCostsToCopy, readLatestRunCosts, writeCostsDraft } from '@/storage/costs';
import { Workspace, paths } from '@/storage/workspace';
import { runInfo } from '../helpers/fixtures';
import { MemoryDir } from '../helpers/memoryFs';

const costs = (month: string, salary: number) => ({
  version: 1,
  month,
  operatorName: 'Ram',
  updatedAt: '2026-11-01T10:00:00.000Z',
  entries: [{ doctorId: 'a', amounts: { SALARY: salary } }],
});

async function runWith(ws: Workspace, month: string, n: number, status: 'Draft' | 'Final', salary: number) {
  await ws.writeJson(`${paths.run(month, n)}/run-info.json`, runInfo(month, n, status));
  await ws.writeJson(`${paths.run(month, n)}/costs.json`, costs(month, salary));
}

describe('costs storage', () => {
  it('writes a draft that reads back, validated', async () => {
    const ws = new Workspace(new MemoryDir('ws'));
    expect(await readCostsDraft(ws, '2026-10')).toBeNull();
    const saved = await writeCostsDraft(ws, {
      month: '2026-10',
      operatorName: 'Ram',
      entries: costs('2026-10', 100).entries,
      now: new Date('2026-11-02T04:30:00Z'),
    });
    expect(saved.updatedAt).toBe('2026-11-02T04:30:00.000Z');
    expect(await readCostsDraft(ws, '2026-10')).toEqual(saved);
  });

  it('refuses to write amounts that are not whole paise', async () => {
    const ws = new Workspace(new MemoryDir('ws'));
    await expect(
      writeCostsDraft(ws, { month: '2026-10', operatorName: 'Ram', entries: [{ doctorId: 'a', amounts: { SALARY: 1.5 } }] }),
    ).rejects.toThrow(/Refusing to save/);
  });

  it('carries forward the newest Final run, else the newest run', async () => {
    const ws = new Workspace(new MemoryDir('ws'));
    await runWith(ws, '2026-09', 1, 'Final', 111);
    await runWith(ws, '2026-09', 2, 'Draft', 222);
    expect((await readLatestRunCosts(ws, '2026-09'))?.entries[0]?.amounts.SALARY).toBe(111);

    await runWith(ws, '2026-08', 1, 'Draft', 333);
    await runWith(ws, '2026-08', 2, 'Draft', 444);
    expect((await readLatestRunCosts(ws, '2026-08'))?.entries[0]?.amounts.SALARY).toBe(444);
    expect(await readLatestRunCosts(ws, '2026-07')).toBeNull();
  });

  it('prefers the draft of a month over its runs when copying', async () => {
    const ws = new Workspace(new MemoryDir('ws'));
    await runWith(ws, '2026-09', 1, 'Final', 111);
    await writeCostsDraft(ws, { month: '2026-09', operatorName: 'Ram', entries: costs('2026-09', 999).entries });
    expect((await readCostsToCopy(ws, '2026-09'))?.entries[0]?.amounts.SALARY).toBe(999);
  });
});
