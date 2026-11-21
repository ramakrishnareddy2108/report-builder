import { describe, expect, it } from 'vitest';
import { doctorReport } from '@/core/report';
import { fillTable } from '@/excel/fillTemplate';
import { loadTemplate } from '@/excel/templates';
import { runMonthTask } from '@/worker/tasks/runMonth';
import { compareReports, formatDifferences, readExpectedReport } from '../helpers/compareExpected';
import { DOCTORS, MONTH, monthRequest } from '../helpers/monthFixture';
import { drrTemplate } from '../helpers/syntheticTemplate';

async function filledDrr(rows: ReturnType<typeof doctorReport>): Promise<Uint8Array> {
  const t = await loadTemplate(await drrTemplate(), 'drr');
  fillTable(t, 'drr', rows);
  return new Uint8Array((await t.workbook.xlsx.writeBuffer()) as ArrayBuffer);
}

async function reportRows() {
  const run = await runMonthTask(monthRequest());
  return doctorReport(run.facts, [], DOCTORS, MONTH);
}

describe('compareExpected', () => {
  it('says an empty template has nothing to compare', async () => {
    expect(await readExpectedReport(await drrTemplate(), 'drr')).toBeNull();
  });

  it('finds no differences between a report and itself, whatever the spelling of the names', async () => {
    const rows = await reportRows();
    const expected = (await readExpectedReport(await filledDrr(rows), 'drr'))!;
    expect(expected.map((e) => e.name)).toContain('A Kumar');
    const respelled = expected.map((e) => ({ ...e, name: e.name.toUpperCase().replace(/ /g, '  ') }));
    expect(compareReports(respelled, rows)).toMatchObject({ differences: [], onlyExpected: [], onlyActual: [], rowsCompared: rows.length });
  });

  it('lists every difference with name, column, expected, actual and diff, and names missing on either side', async () => {
    const rows = await reportRows();
    const expected = (await readExpectedReport(await filledDrr(rows), 'drr'))!;
    const changed = expected
      .filter((e) => !e.name.startsWith('Unmatched'))
      .map((e) => (e.name === 'A Kumar' ? { ...e, values: { ...e.values, OP_REVENUE: 41000, IP_COUNT: 3 } } : e));
    changed.push({ name: 'Somebody Else', values: { OP_REVENUE: 100 } });

    const c = compareReports(changed, rows);
    expect(c.differences).toEqual([
      { name: 'A Kumar', column: 'IP Count', expected: 3, actual: 2, diff: -1 },
      { name: 'A Kumar', column: 'OP Revenue', expected: 41000, actual: 40000, diff: -1000 },
    ]);
    expect(c.onlyExpected).toEqual(['Somebody Else']);
    expect(c.onlyActual).toEqual(['Unmatched doctor (see Checks)']);

    const table = formatDifferences(c);
    expect(table).toMatch(/A Kumar\s+IP Count\s+3\s+2\s+-1/);
    expect(table).toMatch(/A Kumar\s+OP Revenue\s+₹410\.00\s+₹400\.00\s+-₹10\.00/);
    expect(table).toContain('Only in the expected report: Somebody Else');
  });

  it('ignores differences of one rupee or less', async () => {
    const rows = await reportRows();
    const expected = (await readExpectedReport(await filledDrr(rows), 'drr'))!;
    const near = expected.map((e) => ({ ...e, values: { ...e.values, OP_REVENUE: (e.values.OP_REVENUE ?? 0) + 100 } }));
    expect(compareReports(near, rows).differences).toEqual([]);
    expect(compareReports(near, rows, 50).differences.length).toBeGreaterThan(0);
  });
});
