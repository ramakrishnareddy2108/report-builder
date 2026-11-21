// The built-in default mappings against the real October 2026 exports (git-ignored).
// Skipped when samples/ is missing. Prints counts only, never cell values.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDefaultRules } from '@/core/defaults';
import { requiredFields } from '@/core/rules';
import { DEFAULT_SOURCE_MAPPINGS } from '@/core/sourceDefaults';
import { readMappedRows, resolveMapping } from '@/excel/mapSource';
import { readFileTask } from '@/worker/tasks/readFile';

const DIR = 'samples/2026-10';
const present = existsSync(DIR);
const files = present ? readdirSync(DIR).filter((f) => f.endsWith('.xlsx') && !/sponsor-wise|drr format/i.test(f)) : [];
const rules = loadDefaultRules();

describe.skipIf(!present)('default mappings on the real October exports', () => {
  it.each(files)('%s fits its default mapping', { timeout: 60_000 }, async (name) => {
    const probe = await readFileTask({ file: new File([readFileSync(join(DIR, name))], name), headersOnly: true });
    const sourceId = probe.identification.sourceId!;
    const mapping = DEFAULT_SOURCE_MAPPINGS.find((m) => m.sourceId === sourceId)!;

    const r = await readFileTask({ file: new File([readFileSync(join(DIR, name))], name), sheet: mapping.sheet, headerRow: mapping.headerRow });
    const resolved = resolveMapping(mapping, r.header!, requiredFields(rules, sourceId));
    expect(resolved.problems.map((p) => p.message)).toEqual([]);

    const sheet = readMappedRows(resolved, r.data!.rows);
    const reasons: Record<string, number> = {};
    for (const s of sheet.skipped) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
    const issues: Record<string, number> = {};
    for (const row of sheet.rows) for (const i of row.issues) issues[`${i.field}:${i.kind}`] = (issues[`${i.field}:${i.kind}`] ?? 0) + 1;
    console.info(`${sourceId}: read ${sheet.rowsRead}, used ${sheet.rows.length}, skipped ${JSON.stringify(reasons)}, issues ${JSON.stringify(issues)}`);

    expect(sheet.rows.length + sheet.skipped.length).toBe(sheet.rowsRead);
    expect(sheet.rows.length).toBeGreaterThan(0);
  });
});
