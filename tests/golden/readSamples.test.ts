// Reads the real October 2026 HIS exports in samples/ (git-ignored).
// Skipped when samples/ is missing, e.g. in CI. Asserts only on structure —
// no patient data is printed.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SourceId } from '@/core/types';
import { readFileTask } from '@/worker/tasks/readFile';

const DIR = 'samples/2026-10';
const present = existsSync(DIR);

const EXPECTED: Record<SourceId, { sheet: string }> = {
  ipAdmissions: { sheet: 'Sheet1' },
  ipDischarge: { sheet: 'Sheet1' },
  ipGeneralBill: { sheet: 'Sheet1' },
  ipBillBreakups: { sheet: 'Sheet1' },
  opBilling: { sheet: 'Sheet1' },
  opConsultations: { sheet: 'Sheet1' },
  opPharmacySales: { sheet: 'OP pharmacy sales data' },
  opReturns: { sheet: 'Sheet1' },
};

const files = present
  ? readdirSync(DIR).filter((f) => f.endsWith('.xlsx') && !/sponsor-wise|drr format/i.test(f))
  : [];

describe.skipIf(!present)('real October 2026 samples', () => {
  it('has one file per source', () => {
    expect(files).toHaveLength(8);
  });

  it.each(files)('%s is identified with its sheet and header on row 3', { timeout: 60_000 }, async (name) => {
    const bytes = readFileSync(join(DIR, name));
    const file = new File([bytes], name);
    const r = await readFileTask({ file });
    const id = r.identification.sourceId;
    expect(id).not.toBeNull();
    expect(r.identification.confidence).toBeGreaterThanOrEqual(0.95);
    expect(r.sheet).toBe(EXPECTED[id!].sheet);
    expect(r.header?.headerRow).toBe(3);
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.data!.stats.errorCells).toBe(0);
    if (id === 'opConsultations') {
      const col = r.header!.rawHeaders.indexOf('Net Amount');
      expect(col).toBeGreaterThan(-1);
      // Formula column: cached values are numbers on data rows.
      expect(typeof r.data!.rows[3]![col]).toBe('number');
    }
    if (id === 'opPharmacySales') expect(r.data!.rowCount).toBeGreaterThan(12_000);
  });

  it('identifies every source exactly once', async () => {
    const ids = await Promise.all(
      files.map(async (name) => {
        const r = await readFileTask({ file: new File([readFileSync(join(DIR, name))], name), headersOnly: true });
        return r.identification.sourceId;
      }),
    );
    expect(new Set(ids).size).toBe(8);
  }, 120_000);
});
