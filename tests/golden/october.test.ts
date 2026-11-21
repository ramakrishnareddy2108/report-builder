// Full pipeline on the real October 2026 exports (git-ignored). Skipped without samples/.
// Prints counts and totals only, never names or cell values.

import { describe, expect, it } from 'vitest';
import { DoctorMatcher } from '@/core/doctors';
import { runOctober, samplesPresent } from '../helpers/realOctober';
import { pivot, totalValues } from '@/core/aggregate';
import { runChecks } from '@/core/checks';
import { formatINR } from '@/core/money';
import { MEASURES } from '@/core/measures';

describe.skipIf(!samplesPresent)('October 2026 pipeline on the real exports', () => {
  it('runs end to end with every doctor accepted as suggested', { timeout: 180_000 }, async () => {
    const { run, settings, costs } = await runOctober();
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
    console.info(`op overlap pairs ${d.opOverlap.pairs}; unreadable cells ` + JSON.stringify(d.sources.map((s) => [s.sourceId, s.unreadableUnused.count]).filter(([, n]) => n)));

    const checks = runChecks({ month: '2026-10', rules: settings.rules, doctors: settings.doctors.doctors, diagnostics: d, facts: run.facts, costs, previous: null });
    for (const c of checks.filter((x) => x.level !== 'Pass')) console.info(`CHECK ${c.level}: ${c.title} - ${c.message.slice(0, 200)}`);

    expect(d.ruleProblems).toEqual([]);
    expect(d.unmatchedDoctors).toEqual([]);
    expect(run.facts.length).toBeGreaterThan(1000);
    expect(new DoctorMatcher(settings.doctors.doctors).conflicts).toEqual([]);
  });
});
