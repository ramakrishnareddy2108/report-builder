import { beforeAll, describe, expect, it } from 'vitest';
import { runChecks } from '@/core/checks';
import {
  change,
  changePercent,
  compareMonths,
  doctorKey,
  monthDataFromRun,
  monthDataFromSummary,
  topMovers,
  trend,
  type GroupRow,
  type MonthData,
} from '@/core/history';
import { doctorReport } from '@/core/report';
import type { RunOutput } from '@/core/runMonth';
import { SCHEMA_VERSION, type SettingsUsedFile, type SummaryFile } from '@/core/schemas';
import { MEASURE_CODES, type CostEntry } from '@/core/types';
import { fillTable } from '@/excel/fillTemplate';
import { loadTemplate } from '@/excel/templates';
import { importSummaryMonth, listOverviews, loadBestMonth, SummaryImportError, toSummaryRows } from '@/storage/history';
import { listRuns, writeRun, type RunBundle } from '@/storage/runs';
import { Workspace } from '@/storage/workspace';
import { readReportTask } from '@/worker/tasks/reports';
import { runMonthTask } from '@/worker/tasks/runMonth';
import { DOCTORS, DR_A, DR_B, MONTH, monthRequest, monthSettings } from '../helpers/monthFixture';
import { MemoryDir } from '../helpers/memoryFs';
import { drrTemplate, sponsorTemplate } from '../helpers/syntheticTemplate';

const costs: CostEntry[] = [{ doctorId: DR_A, amounts: { SALARY: 500000 } }];

let run: RunOutput;
let data: MonthData;
beforeAll(async () => {
  run = await runMonthTask(monthRequest());
  data = monthDataFromRun({ month: MONTH, runNumber: 1, status: 'Final', facts: run.facts, costs, doctors: DOCTORS, checks: [] });
});

const row = (key: string, name: string, over: Partial<GroupRow['values']> = {}): GroupRow => ({
  key,
  name,
  values: { ...Object.fromEntries(MEASURE_CODES.map((k) => [k, 0])), ...over } as GroupRow['values'],
});

describe('monthDataFromRun', () => {
  it('has doctor, department and sponsor rows and the month totals', () => {
    expect(data.levels.doctor.map((r) => r.name)).toEqual(['A Kumar', 'B Rao', 'Pharmacy – Unattributed', 'Unmatched doctor (see Checks)']);
    expect(data.levels.department.map((r) => r.key)).toEqual(['CARDIOLOGY', 'ENT', 'UROLOGY', '__none__']); // pharmacy facts have no department
    expect(data.levels.sponsor.map((r) => r.name)).toEqual(['GENERAL', 'STAR']);
    expect(data.totals.IP_COUNT).toBe(4);
  });

  it('keys doctors by normalised name, so a spelling or an id change never splits a doctor', () => {
    expect(data.levels.doctor[0]?.key).toBe('A KUMAR');
    expect(doctorKey('Dr. A.Kumar')).toBe('A KUMAR');
    expect(doctorKey('K.Krishna Chand')).toBe(doctorKey('K KRISHNA CHAND'));
  });

  it('counts the Fails and Warnings of the run', () => {
    const checks = runChecks({ month: MONTH, rules: monthSettings().rules, doctors: DOCTORS, diagnostics: run.diagnostics, facts: run.facts, costs, previous: null });
    const m = monthDataFromRun({ month: MONTH, runNumber: 1, status: 'Draft', facts: run.facts, costs, doctors: DOCTORS, checks });
    expect(m.checks).toEqual({ fail: 1, warning: 3 });
    expect(m.kind).toBe('run');
  });

  it('puts the doctor costs into Gross Profit', () => {
    const without = monthDataFromRun({ month: MONTH, runNumber: 1, status: 'Final', facts: run.facts, costs: [], doctors: DOCTORS, checks: [] });
    expect(without.totals.GROSS_PROFIT - data.totals.GROSS_PROFIT).toBe(500000);
    expect(data.levels.department.find((r) => r.key === 'CARDIOLOGY')?.values.SALARY).toBe(500000); // via the doctor's department
  });
});

describe('monthDataFromSummary', () => {
  const summary: SummaryFile = {
    version: 1, month: '2026-03', runNumber: 1, sourceFile: 'DRR March.xlsx',
    rows: [
      { name: 'K.Krishna Chand', department: 'Cardiology', values: { IP_COUNT: 10, IP_REVENUE: 1000000, OP_REVENUE: 200000, OP_PHARMACY: 50000, SALARY: 100000 } },
      { name: 'D Swetha', department: 'cardiology', values: { IP_REVENUE: 500000 } },
      { name: 'P Lalitha', department: '', values: { OP_REVENUE: 1 } },
    ],
  };
  const m = monthDataFromSummary({ runNumber: 1, status: 'Final' }, summary);

  it('computes the calculated columns from the parts, and has no sponsor data or checks', () => {
    const kk = m.levels.doctor.find((r) => r.name === 'K.Krishna Chand')!;
    expect(kk.values.TOTAL_REVENUE).toBe(1250000);
    expect(kk.values.GROSS_PROFIT).toBe(1250000 - 100000);
    expect(m.levels.sponsor).toEqual([]);
    expect(m.checks).toBeNull();
    expect(m.kind).toBe('summary');
  });

  it('groups departments ignoring case, and keeps doctors with no department apart', () => {
    expect(m.levels.department.map((r) => [r.key, r.values.IP_REVENUE])).toEqual([['CARDIOLOGY', 1500000], ['__none__', 0]]);
  });

  it('matches the same doctor in a normal month by key', () => {
    expect(m.levels.doctor[0]?.key).toBe('K KRISHNA CHAND');
  });
});

describe('compareMonths', () => {
  const a = [row('A', 'Alpha', { OP_REVENUE: 1500 }), row('N', 'New', { OP_REVENUE: 700 })];
  const b = [row('A', 'Alpha', { OP_REVENUE: 1000 }), row('G', 'Gone', { OP_REVENUE: 400 })];
  const rows = compareMonths(a, b);

  it('joins both months by key; a row in one month only has null for the other', () => {
    expect(rows.map((r) => [r.name, r.a !== null, r.b !== null])).toEqual([
      ['Alpha', true, true],
      ['Gone', false, true],
      ['New', true, false],
    ]);
  });

  it('works out change (A - B) and change percent of B; a new row has no percent', () => {
    const [alpha, gone, added] = rows as [typeof rows[0], typeof rows[0], typeof rows[0]];
    expect(change(alpha, 'OP_REVENUE')).toBe(500);
    expect(changePercent(alpha, 'OP_REVENUE')).toBe(50);
    expect(change(gone, 'OP_REVENUE')).toBe(-400);
    expect(changePercent(gone, 'OP_REVENUE')).toBe(-100);
    expect(change(added, 'OP_REVENUE')).toBe(700);
    expect(changePercent(added, 'OP_REVENUE')).toBeNull();
  });

  it('lists the biggest risers and fallers, by amount', () => {
    const { risers, fallers } = topMovers(rows, 'OP_REVENUE');
    expect(risers.map((m) => [m.name, m.change])).toEqual([['New', 700], ['Alpha', 500]]);
    expect(fallers.map((m) => [m.name, m.change])).toEqual([['Gone', -400]]);
    expect(topMovers(rows, 'OP_REVENUE', 1).risers).toHaveLength(1);
  });

  it('ignores rows that did not change', () => {
    expect(topMovers(compareMonths(a, a), 'OP_REVENUE')).toEqual({ risers: [], fallers: [] });
  });
});

describe('trend', () => {
  const month = (m: string, rows: GroupRow[]): MonthData => ({
    month: m, runNumber: 1, status: 'Final', kind: 'run', checks: null,
    levels: { doctor: rows, department: [], sponsor: [] },
    totals: row('t', 't', { OP_REVENUE: rows.reduce((n, r) => n + r.values.OP_REVENUE, 0) }).values,
  });
  const months = [
    month('2026-03', [row('A', 'Alpha', { OP_REVENUE: 100 }), row('B', 'Beta', { OP_REVENUE: 10 })]),
    month('2026-01', [row('A', 'Alpha', { OP_REVENUE: 50 })]),
    month('2026-02', [row('A', 'Alpha', { OP_REVENUE: 70 }), row('B', 'Beta', { OP_REVENUE: 5 }), row('C', 'Gamma', { OP_REVENUE: 1 })]),
  ];

  it('overall: one line over the months, oldest first', () => {
    expect(trend(months, 'overall', 'OP_REVENUE')).toEqual({ months: ['2026-01', '2026-02', '2026-03'], series: [{ name: 'All', points: [50, 76, 110] }] });
  });

  it('by doctor: the largest ones, with nulls where a month has no row', () => {
    const t = trend(months, 'doctor', 'OP_REVENUE', 2);
    expect(t.series.map((s) => s.name)).toEqual(['Alpha', 'Beta']);
    expect(t.series[1]?.points).toEqual([null, 5, 10]);
  });

  it('a level with no data (sponsors of a summary month) gives no series', () => {
    expect(trend(months, 'sponsor', 'OP_REVENUE').series).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const settingsUsed = (): SettingsUsedFile => {
  const s = monthSettings();
  return { version: SCHEMA_VERSION, sources: s.sources, doctors: s.doctors, rules: s.rules, costsDefaults: null };
};

function bundle(month: string, runNumber: number, status: 'Draft' | 'Final', factScale = 1): RunBundle {
  return {
    info: { version: SCHEMA_VERSION, month, runNumber, status, createdAt: `2026-11-0${runNumber}T10:00:00.000Z`, ...(status === 'Final' ? { finalizedAt: '2026-11-09T10:00:00.000Z' } : {}), operatorName: 'Ram', reason: null, files: [] },
    facts: { version: SCHEMA_VERSION, month, runNumber, facts: run.facts.map((f) => ({ ...f, month, amountPaise: f.measure === 'IP_COUNT' ? f.amountPaise : f.amountPaise * factScale })) },
    costs: { version: SCHEMA_VERSION, month, operatorName: 'Ram', updatedAt: '2026-11-01T10:00:00.000Z', entries: costs },
    checks: { version: SCHEMA_VERSION, month, runNumber, checks: [] },
    settingsUsed: settingsUsed(),
  };
}

describe('listing months', () => {
  it('lists months newest first with totals from the newest run, and uses the newest Final run for compare', async () => {
    const ws = new Workspace(new MemoryDir('ws'));
    await writeRun(ws, bundle('2026-09', 1, 'Final'));
    await writeRun(ws, bundle('2026-10', 1, 'Final', 1));
    await writeRun(ws, bundle('2026-10', 2, 'Draft', 2)); // a later draft with doubled amounts

    const overviews = await listOverviews(ws);
    expect(overviews.map((o) => o.month)).toEqual(['2026-10', '2026-09']);
    const oct = overviews[0]!;
    expect(oct.latest?.runNumber).toBe(2);
    expect(oct.latestData?.status).toBe('Draft');
    expect(oct.bestData?.runNumber).toBe(1); // the Final run is what trends and comparisons use
    expect(oct.latestData!.totals.OP_REVENUE).toBe(oct.bestData!.totals.OP_REVENUE * 2);
  });

  it('shows a month that cannot be read with the reason, and keeps listing the others', async () => {
    const ws = new Workspace(new MemoryDir('ws'));
    await writeRun(ws, bundle('2026-09', 1, 'Final'));
    await ws.writeFile('data/2026-10/run-1/run-info.json', JSON.stringify({ ...bundle('2026-10', 1, 'Final').info }));
    const overviews = await listOverviews(ws);
    expect(overviews.map((o) => o.month)).toEqual(['2026-10', '2026-09']);
    expect(overviews[0]?.error).toMatch(/is missing/);
    expect(overviews[1]?.error).toBeUndefined();
  });

  it('reads the new numbers after a Draft is saved again (the cache follows the run)', async () => {
    const ws = new Workspace(new MemoryDir('ws'));
    await writeRun(ws, bundle('2026-10', 1, 'Draft', 1));
    const before = (await loadBestMonth(ws, '2026-10'))!.totals.OP_REVENUE;
    const again = bundle('2026-10', 1, 'Draft', 3);
    again.info.createdAt = '2026-11-05T10:00:00.000Z';
    await writeRun(ws, again);
    expect((await loadBestMonth(ws, '2026-10'))!.totals.OP_REVENUE).toBe(before * 3);
  });
});

describe('importing a past DRR as a summary month', () => {
  const rows = toSummaryRows([
    { name: 'A Kumar', department: 'Cardiology', values: { IP_COUNT: 3, IP_REVENUE: 1000000, OP_REVENUE: 50000, TOTAL_REVENUE: 1050000 } },
    { name: 'B Rao', department: 'Urology', values: { OP_REVENUE: 20000 } },
  ]);

  it('saves a Final run of kind summary with no fact rows, and it reads back as a month', async () => {
    const ws = new Workspace(new MemoryDir('ws'));
    await importSummaryMonth(ws, { month: '2026-03', sourceFile: 'DRR March.xlsx', rows, operatorName: 'Ram', settings: settingsUsed(), now: new Date('2026-11-21T10:00:00Z') });

    const [saved] = await listRuns(ws, '2026-03');
    expect(saved?.info).toMatchObject({ kind: 'summary', status: 'Final', runNumber: 1, reason: 'Imported from DRR March.xlsx', operatorName: 'Ram' });
    const m = (await loadBestMonth(ws, '2026-03'))!;
    expect(m).toMatchObject({ kind: 'summary', status: 'Final', checks: null });
    expect(m.totals.IP_COUNT).toBe(3);
    expect(m.totals.TOTAL_REVENUE).toBe(1000000 + 50000 + 20000);
  });

  it('turns blank columns into 0 and drops the calculated columns (they are recomputed)', () => {
    expect(rows[1]?.values).toEqual({ IP_COUNT: 0, IP_REVENUE: 0, OP_REVENUE: 20000, OP_PHARMACY: 0, OP_PHARMACY_COST: 0, IP_PHARMACY_NET: 0, IP_PHARMACY_COST: 0, DEPT_ISSUES: 0, SALARY: 0, INCENTIVES: 0, PROF_FEE: 0 });
  });

  it('refuses a month that already has a run, an empty file, and a missing name', async () => {
    const ws = new Workspace(new MemoryDir('ws'));
    await writeRun(ws, bundle('2026-03', 1, 'Draft'));
    const base = { month: '2026-03', sourceFile: 'x.xlsx', rows, operatorName: 'Ram', settings: settingsUsed() };
    await expect(importSummaryMonth(ws, base)).rejects.toThrow(/already has a saved run/);
    await expect(importSummaryMonth(ws, { ...base, month: '2026-04', rows: [] })).rejects.toThrow(SummaryImportError);
    await expect(importSummaryMonth(ws, { ...base, month: '2026-04', operatorName: ' ' })).rejects.toThrow(/Enter your name/);
  });

  it('a summary month is read-only like any Final run', async () => {
    const ws = new Workspace(new MemoryDir('ws'));
    await importSummaryMonth(ws, { month: '2026-03', sourceFile: 'x.xlsx', rows, operatorName: 'Ram', settings: settingsUsed() });
    await expect(writeRun(ws, bundle('2026-03', 1, 'Draft'))).rejects.toThrow(/Final and cannot be changed/);
  });
});

describe('readReportTask (a past DRR)', () => {
  async function filled(modify?: (sheet: import('exceljs').Worksheet) => void): Promise<ArrayBuffer> {
    const t = await loadTemplate(await drrTemplate(), 'drr');
    fillTable(t, 'drr', doctorReport(run.facts, costs, DOCTORS, MONTH));
    modify?.(t.sheet);
    return (await t.workbook.xlsx.writeBuffer()) as ArrayBuffer;
  }

  it('reads the doctor rows of a filled DRR in paise', async () => {
    const r = await readReportTask({ bytes: await filled() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = r.rows.find((x) => x.name === 'A Kumar')!;
    expect(a).toMatchObject({ department: 'Cardiology' });
    expect(a.values.IP_COUNT).toBe(2);
    expect(a.values.IP_REVENUE).toBe(1150025);
    expect(a.values.SALARY).toBe(500000);
    expect(r.inconsistentRows).toEqual([]);
  });

  it('says so for an empty template, a sponsor-wise file and a file that is not a workbook', async () => {
    expect(await readReportTask({ bytes: (await drrTemplate()).buffer as ArrayBuffer })).toMatchObject({ ok: false, message: expect.stringMatching(/empty template/) });
    expect(await readReportTask({ bytes: (await sponsorTemplate()).buffer as ArrayBuffer })).toMatchObject({ ok: false });
    expect(await readReportTask({ bytes: new Uint8Array([1, 2, 3]).buffer })).toMatchObject({ ok: false, message: expect.stringMatching(/could not be read/) });
  });

  it('names rows whose Total Revenue does not equal the sum of their parts', async () => {
    const bytes = await filled((sheet) => {
      sheet.getRow(5).getCell('I').value = { formula: '+F5+G5+H5', result: 999 }; // Total Revenue typed over
    });
    const r = await readReportTask({ bytes });
    expect(r).toMatchObject({ ok: true, inconsistentRows: ['A Kumar'] });
  });
});

describe('summary schema', () => {
  it('describes summary.json and a kind of summary in run-info.json to the backup', async () => {
    const { describeJsonPath } = await import('@/storage/workspace');
    expect(describeJsonPath('data/2026-03/run-1/summary.json')).toMatchObject({ area: 'run', month: '2026-03', runNumber: 1 });
  });
});

void DR_B;
