// The real report templates filled with the real October numbers (git-ignored samples/).
// Skipped without samples/. Checks structure, formulas and totals; never prints names.

import { existsSync, readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { doctorReport, reportTotals, sponsorReport } from '@/core/report';
import { buildReport } from '@/excel/buildReport';
import { checkTemplate } from '@/excel/templateCheck';
import { SAMPLES_DIR, runOctober, samplesPresent } from '../helpers/realOctober';

const DRR = `${SAMPLES_DIR}/expected/DRR Format.xlsx`;
const SPONSOR = `${SAMPLES_DIR}/Sponsor-wise Revenue Report.xlsx`;
const have = samplesPresent && existsSync(DRR) && existsSync(SPONSOR);

const sheet = async (bytes: Uint8Array) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb;
};

describe.skipIf(!have)('real templates with the real October numbers', () => {
  it('pass the self-check, fill, and keep their shared formulas', { timeout: 180_000 }, async () => {
    const { run, settings, costs } = await runOctober();
    const doctors = settings.doctors.doctors;
    const drrRows = doctorReport(run.facts, costs, doctors, '2026-10');
    const sponsorRows = sponsorReport(run.facts, '2026-10');
    const names = new Map(doctors.map((d) => [d.id, d.displayName]));

    expect((await checkTemplate(readFileSync(DRR), 'drr', drrRows)).level).toBe('Pass');
    expect((await checkTemplate(readFileSync(SPONSOR), 'sponsor', sponsorRows)).level).toBe('Pass');

    for (const [kind, path, rows, last] of [['drr', DRR, drrRows, 'Q'], ['sponsor', SPONSOR, sponsorRows, 'L']] as const) {
      const built = await buildReport({ template: readFileSync(path), kind, rows, checks: [], facts: run.facts, doctorNames: names });
      const wb = await sheet(built.bytes);
      expect(wb.worksheets.map((w) => w.name)).toEqual(['Sheet1', 'Checks', 'Data']);
      const ws = wb.getWorksheet('Sheet1')!;
      console.info(`${kind}: ${built.fill.rowsWritten} rows written, ${built.fill.rowsCleared} cleared, ${built.fill.rowsAdded} added, notes ${JSON.stringify(built.fill.notes)}`);

      // The first row has its formulas with the right numbers; a row far below (still the template's) keeps its formula too.
      const total = reportTotals(rows);
      const gross = ws.getRow(5).getCell(last).value as { result: number };
      expect(gross.result).toBeCloseTo(rows[0]!.values.GROSS_PROFIT / 100, 2);
      expect(ws.getRow(496).getCell(last).formula).toMatch(/^\+[A-Z]+496-/);
      expect(ws.getRow(496).getCell('A').value).toBeNull(); // unused row: numbering cleared
      expect(ws.getRow(2).getCell(kind === 'drr' ? 'E' : 'D').formula).toBe(`SUBTOTAL(9,${kind === 'drr' ? 'E' : 'D'}5:${kind === 'drr' ? 'E' : 'D'}960)`);
      console.info(`${kind}: Total Revenue ${total.TOTAL_REVENUE / 100}, Gross Profit ${total.GROSS_PROFIT / 100}`);
    }
  });
});
