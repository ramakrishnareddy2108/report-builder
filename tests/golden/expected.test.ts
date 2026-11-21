// The tool's October reports against a filled report in samples/2026-10/expected/ (git-ignored).
//
// Skipped when samples/ is missing, or when the expected files are still empty templates.
// When a filled DRR / Sponsor-wise report is there, every row and every column is compared
// and the differences are printed as a table (name, column, expected, actual, diff).
// A difference usually points at a business rule; do not change a rule just to make a number match.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { doctorReport, sponsorReport } from '@/core/report';
import { compareReports, formatDifferences, readExpectedReport } from '../helpers/compareExpected';
import { SAMPLES_DIR, runOctober, samplesPresent } from '../helpers/realOctober';

const EXPECTED = `${SAMPLES_DIR}/expected`;
const FILES = {
  drr: `${EXPECTED}/DRR Format.xlsx`,
  sponsor: `${EXPECTED}/Sponsor-wise Revenue Report.xlsx`,
} as const;

describe.skipIf(!samplesPresent)('October reports against the filled expected reports', () => {
  it('match per row and per column', { timeout: 180_000 }, async () => {
    const { run, settings, costs } = await runOctober();
    const actual = {
      drr: doctorReport(run.facts, costs, settings.doctors.doctors, '2026-10'),
      sponsor: sponsorReport(run.facts, '2026-10'),
    };

    let compared = 0;
    for (const kind of ['drr', 'sponsor'] as const) {
      if (!existsSync(FILES[kind])) {
        console.info(`Expected ${kind} report not found at ${FILES[kind]}: nothing to compare.`);
        continue;
      }
      const expected = await readExpectedReport(readFileSync(FILES[kind]), kind);
      if (!expected) {
        console.info(`${FILES[kind]} has no filled rows (an empty template): nothing to compare. Put a filled October report there to compare.`);
        continue;
      }
      const result = compareReports(expected, actual[kind]);
      compared += result.rowsCompared;
      if (result.differences.length > 0 || result.onlyExpected.length > 0 || result.onlyActual.length > 0) {
        console.info(`\n${kind.toUpperCase()}: ${result.differences.length} differences over ${result.rowsCompared} rows\n${formatDifferences(result)}\n`);
      }
      expect(result.differences, `${kind} differences`).toEqual([]);
      expect(result.onlyExpected, `${kind} names only in the expected report`).toEqual([]);
    }
    console.info(`Expected reports compared: ${compared} rows.`);
  });
});
