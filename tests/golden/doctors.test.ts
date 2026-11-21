// Doctor names in the real October 2026 exports (git-ignored). Skipped without samples/.
// Prints counts only.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { suggestDoctors, suggestGroups } from '@/core/doctors';
import { DEFAULT_SOURCE_MAPPINGS } from '@/core/sourceDefaults';
import { collectNamesTask } from '@/worker/tasks/collectNames';

const DIR = 'samples/2026-10';
const present = existsSync(DIR);

describe.skipIf(!present)('doctor names in the real October exports', () => {
  it('collapse to a few dozen suggestions', { timeout: 120_000 }, async () => {
    const sources = readdirSync(DIR)
      .filter((f) => f.endsWith('.xlsx') && !/sponsor-wise|drr format|pharmacy|returns/i.test(f))
      .flatMap((name) => {
        const mapping = DEFAULT_SOURCE_MAPPINGS.find((m) => name.toLowerCase().startsWith(m.namePattern.toLowerCase().slice(0, 12)));
        return mapping ? [{ sourceId: mapping.sourceId, file: new File([readFileSync(join(DIR, name))], name), mapping, required: [] }] : [];
      });
    expect(sources.length).toBe(6);

    const r = await collectNamesTask({ sources });
    expect(r.sources.map((s) => s.status)).toEqual(Array(6).fill('scanned'));
    const doctors = suggestDoctors(r.doctors, []);
    const departments = suggestGroups(r.departments, []);
    const sponsors = suggestGroups(r.sponsors, []);
    console.info(
      `doctors: ${r.doctors.length} raw spellings -> ${doctors.length} suggestions; ` +
        `departments: ${r.departments.length} -> ${departments.length}; sponsors: ${r.sponsors.length} -> ${sponsors.length}`,
    );
    expect(doctors.length).toBeGreaterThan(40);
    expect(doctors.length).toBeLessThan(r.doctors.length);
    expect(doctors.reduce((n, d) => n + d.count, 0)).toBe(r.doctors.reduce((n, d) => n + d.count, 0)); // no name lost
  });
});
