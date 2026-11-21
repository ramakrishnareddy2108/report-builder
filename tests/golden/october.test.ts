// Full pipeline on the real October 2026 exports (git-ignored). Skipped without samples/.
// Prints counts and totals only, never names or cell values.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pivot, totalValues } from '@/core/aggregate';
import { formatINR } from '@/core/money';
import { MEASURES } from '@/core/measures';
import { DEFAULT_SOURCE_MAPPINGS } from '@/core/sourceDefaults';
import { loadDefaultRules } from '@/core/defaults';
import { DoctorMatcher, NameCounter, acceptSuggestions, suggestDoctors } from '@/core/doctors';
import { readFileTask } from '@/worker/tasks/readFile';
import { collectNamesTask } from '@/worker/tasks/collectNames';
import { runMonthTask } from '@/worker/tasks/runMonth';
import type { SourceId } from '@/core/types';
import type { RunSettings } from '@/core/runMonth';

const DIR = 'samples/2026-10';
const present = existsSync(DIR);

async function loadFiles(): Promise<{ sourceId: SourceId; file: File }[]> {
  const out: { sourceId: SourceId; file: File }[] = [];
  for (const name of readdirSync(DIR).filter((f) => f.endsWith('.xlsx') && !/sponsor-wise|drr format/i.test(f))) {
    const file = new File([readFileSync(join(DIR, name))], name);
    const { identification } = await readFileTask({ file, headersOnly: true });
    out.push({ sourceId: identification.sourceId as SourceId, file });
  }
  return out;
}

describe.skipIf(!present)('October 2026 pipeline on the real exports', () => {
  it('runs end to end with every doctor accepted as suggested', { timeout: 180_000 }, async () => {
    const files = await loadFiles();
    const base: RunSettings = {
      sources: { version: 1, sources: DEFAULT_SOURCE_MAPPINGS.map((m) => structuredClone(m)) },
      doctors: { version: 1, doctors: [], departments: [], sponsors: [] },
      rules: loadDefaultRules(),
    };

    // Doctors: accept the suggestions, as a user would on the Doctors page.
    const names = await collectNamesTask({
      sources: files
        .map((f) => ({ ...f, mapping: base.sources.sources.find((m) => m.sourceId === f.sourceId)!, required: [] as never[] }))
        .filter((s) => s.mapping.fields.doctor),
    });
    const settings: RunSettings = {
      ...base,
      doctors: { ...base.doctors, doctors: acceptSuggestions([], suggestDoctors(names.doctors, [])) },
    };

    const run = await runMonthTask({ month: '2026-10', files, settings });
    const d = run.diagnostics;

    for (const s of d.sources.filter((x) => x.needed)) {
      console.info(
        `${s.sourceId}: ${s.status}, read ${s.rowsRead}, mapped ${s.rowsMapped}, skipped ` +
          JSON.stringify(Object.fromEntries(Object.entries(s.skipped).filter(([, c]) => c.count > 0).map(([k, c]) => [k, c.count]))),
      );
      expect(s.status).toBe('read');
    }
    for (const t of d.terms) {
      console.info(
        `${t.measure} <- ${t.sourceId}[${t.termIndex}]: ${t.facts} facts of ${t.rowsConsidered}, sum ${formatINR(t.sumPaise)}, filtered ${t.filtered}, ipViaOp ${t.ipViaOp.count}, bad ${t.badAmount.count}, outside month ${t.outsideMonth.count}`,
      );
      expect(t.facts + t.filtered + t.ipViaOp.count + t.filterError.count + t.badAmount.count).toBe(t.rowsConsidered);
    }
    const total = totalValues(pivot(run.facts, 'doctor'));
    console.info('TOTALS ' + MEASURES.map((m) => `${m.code}=${m.kind === 'count' ? total[m.code] : formatINR(total[m.code])}`).join(' | '));
    const status: Record<string, number> = {};
    for (const f of run.facts) if (f.attributionStatus) status[f.attributionStatus] = (status[f.attributionStatus] ?? 0) + 1;
    console.info('pharmacy attribution rows ' + JSON.stringify(status));
    console.info(`unmatched doctors ${d.unmatchedDoctors.length}, duplicate refs ` + JSON.stringify(d.sources.map((s) => [s.sourceId, s.duplicateRefs.rows]).filter(([, n]) => n)));
    console.info(`op overlap pairs ${d.opOverlap.pairs}; unreadable cells ` + JSON.stringify(d.sources.map((s) => [s.sourceId, s.unreadableCells.count]).filter(([, n]) => n)));

    expect(d.ruleProblems).toEqual([]);
    expect(d.unmatchedDoctors).toEqual([]);
    expect(run.facts.length).toBeGreaterThan(1000);
    expect(new DoctorMatcher(settings.doctors.doctors).conflicts).toEqual([]);
    void NameCounter;
  });
});
