// Three fixes found when checking the October 2026 DRR against the source files:
//   1. lookups: calendar-day comparison, 'Ambiguous' ties and the tie-break rule, Ambiguous in the Checks
//   2. cleanup: dots become spaces, leading "Dr" and a trailing "(REVIEW)" are stripped, with a preview
//   3. report: hide rows where every aggregate column is 0, and list them in the Checks

import { describe, expect, it } from 'vitest';
import { buildChecks } from '@/engine/checks';
import { cleanup, cleanText } from '@/engine/cleanup';
import { runLookups } from '@/engine/lookups';
import { buildReport } from '@/engine/report';
import type { CombinedTable } from '@/engine/types';
import { CleanupRuleSchema, DEFAULT_TIE_BREAK_FORMULA, LookupRuleSchema, type CleanupRule, type LookupRule } from '@/recipe/schema';

type ColType = 'text' | 'money' | 'number' | 'date';
const table = (names: string[], data: (string | number | null)[][], types: Record<string, ColType> = {}): CombinedTable => ({
  columns: names.map((n) => ({ name: n, type: types[n] ?? 'text' })),
  rows: data.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i] ?? null]))),
});

// ---- 2. cleanup -----------------------------------------------------------------------------------------------------

describe('cleanup: dots, Dr prefix, (REVIEW) suffix', () => {
  const rule = (normalize: Partial<CleanupRule['normalize']> = {}): CleanupRule => ({
    column: 'Doctor',
    normalize: { trim: true, collapseSpaces: true, ignoreCase: true, removeChars: '', dotsToSpace: true, stripDrPrefix: true, stripSuffix: { enabled: true, text: ' (REVIEW)' }, ...normalize },
    displayCase: 'title',
    aliases: [],
  });
  const clean = (names: (string | null)[], r: CleanupRule = rule()) => {
    const t = table(['Doctor'], names.map((n) => [n]));
    const out = cleanup(t, [r]);
    return { names: t.rows.map((x) => x.Doctor), report: out.reports[0]! };
  };

  it('"K.KRISHNA CHAND" becomes "K Krishna Chand" (the dot is a space, not removed)', () => {
    expect(clean(['K.KRISHNA CHAND']).names).toEqual(['K Krishna Chand']);
    // removing the dot (the old behaviour) glued the words together
    expect(clean(['K.KRISHNA CHAND'], rule({ dotsToSpace: false, removeChars: '.' })).names).toEqual(['Kkrishna Chand']);
  });

  it('"Dr Srimannarayana (Review)" becomes "Srimannarayana"', () => {
    expect(clean(['Dr Srimannarayana (Review)']).names).toEqual(['Srimannarayana']);
  });

  it('all the spellings of one doctor become one name, and the preview lists what was changed', () => {
    const { names, report } = clean(['DR. SRIMANNARAYANA', 'Srimannarayana (REVIEW)', 'dr srimannarayana (review)', 'Srimannarayana', 'Dr.Srimannarayana']);
    expect(names).toEqual(['Srimannarayana', 'Srimannarayana', 'Srimannarayana', 'Srimannarayana', 'Srimannarayana']);
    expect(report).toMatchObject({ rawNames: 5, cleanNames: 1 });
    const steps = Object.fromEntries(report.values.map((v) => [v.raw, v.steps ?? []]));
    expect(steps).toEqual({
      'DR. SRIMANNARAYANA': ['dots', 'prefix'],
      'Srimannarayana (REVIEW)': ['suffix'],
      'dr srimannarayana (review)': ['suffix', 'prefix'],
      Srimannarayana: [],
      'Dr.Srimannarayana': ['dots', 'prefix'],
    });
  });

  it('each option can be switched off', () => {
    expect(clean(['Dr Rao (Review)'], rule({ stripDrPrefix: false })).names).toEqual(['Dr Rao']);
    expect(clean(['Dr Rao (Review)'], rule({ stripSuffix: { enabled: false, text: ' (REVIEW)' } })).names).toEqual(['Rao (Review)']);
    expect(clean(['K.Rao'], rule({ dotsToSpace: false })).names).toEqual(['K.Rao']); // the dot is kept (and title case capitalises after it)
  });

  it('never leaves a name empty and does not cut inside a word', () => {
    expect(cleanText('(REVIEW)', rule()).text).toBe('(REVIEW)');
    expect(cleanText('Dr', rule()).text).toBe('Dr');
    expect(cleanText('Drake Rao', rule()).text).toBe('Drake Rao');
    expect(cleanText('Dr (Review)', rule()).text).toBe('Dr');
  });

  it('a rule saved before these options existed behaves as it did', () => {
    const old = CleanupRuleSchema.parse({ column: 'Doctor', normalize: { trim: true, collapseSpaces: true, ignoreCase: true, removeChars: '.' }, displayCase: 'title', aliases: [] });
    expect(cleanText('K.KRISHNA', old)).toEqual({ text: 'KKRISHNA', steps: [] });
    expect(cleanText('Dr Rao (Review)', old).text).toBe('Dr Rao (Review)');
  });

  it('an alias target goes through the same steps, so a joined name still lands on one name', () => {
    const t = table(['Doctor'], [['Dr Anil Kumar'], ['ANILKUMAR (REVIEW)']]);
    cleanup(t, [{ ...rule(), aliases: [{ to: 'Dr Anil Kumar', from: ['Anilkumar'] }] }]);
    expect(t.rows.map((r) => r.Doctor)).toEqual(['Anil Kumar', 'Anil Kumar']);
  });
});

// ---- 1. lookups -------------------------------------------------------------------------------------------------------

describe('lookups: ties on the same day are Ambiguous', () => {
  const sources = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] as never;
  const cols = ['Source', 'Key', 'Date', 'Doctor', 'Dept', 'Amount'];
  const make = (consultations: (string | number | null)[][], target: (string | number | null)[][] = [['A', 'U1', '2026-10-06', null, null, 1000]]) =>
    table(cols, [...consultations, ...target], { Date: 'date', Amount: 'money' });
  const rule = (extra: Partial<LookupRule> = {}): LookupRule => ({
    label: 'L',
    target: { source: 'a', column: 'Doctor', key: 'Key', date: 'Date' },
    from: { source: 'b', key: 'Key', value: 'Doctor', date: 'Date', extraValues: [{ from: 'Dept', as: 'Dept' }] },
    pick: 'latestOnOrBefore',
    notFoundValue: 'Unattributed',
    writeStatusColumn: 'Status',
    ...extra,
  });
  const prefer = (then: 'first' | 'unattributed' = 'first'): LookupRule['tieBreak'] => ({ method: 'preferNotMatching', preferFormula: DEFAULT_TIE_BREAK_FORMULA, then });
  const last = (t: CombinedTable) => t.rows[t.rows.length - 1]!;

  // Two consultations of one patient on the same day (the same timestamp in the HIS export)
  const SAME_DAY = [
    ['B', 'U1', '2026-10-05', 'General Consultation', 'General Medicine', null],
    ['B', 'U1', '2026-10-05', 'Dr Rao', 'Cardiology', null],
  ];

  it('the same-timestamp multi-consultation case is Ambiguous, not Matched, and the "real" doctor is preferred', () => {
    const t = make(SAME_DAY);
    const r = runLookups(t, [rule({ tieBreak: prefer() })], { sources });
    expect(last(t)).toMatchObject({ Doctor: 'Dr Rao', Dept: 'Cardiology', Status: 'Ambiguous' });
    expect(r.results[0]).toMatchObject({
      considered: 1,
      byStatus: { Matched: 0, Fallback: 0, Ambiguous: 1, Unattributed: 0 },
      amountByStatus: { Matched: 0, Fallback: 0, Ambiguous: 1000, Unattributed: 0 },
    });
    expect(r.results[0]?.ambiguousExamples).toEqual([{ key: 'U1', day: '2026-10-06', values: ['General Consultation', 'Dr Rao'], written: 'Dr Rao' }]);
  });

  it('shows one example per patient and day, however many line items share them', () => {
    const t = make(SAME_DAY, [['A', 'U1', '2026-10-06', null, null, 100], ['A', 'U1', '2026-10-06', null, null, 200], ['A', 'U1', '2026-10-07', null, null, 300]]);
    const r = runLookups(t, [rule({ tieBreak: prefer() })], { sources });
    expect(r.results[0]?.byStatus.Ambiguous).toBe(3); // every row is counted
    expect(r.results[0]?.ambiguousExamples.map((a) => a.day)).toEqual(['2026-10-06', '2026-10-07']);
  });

  it('the preferred value does not depend on the order in the file', () => {
    const t = make([...SAME_DAY].reverse());
    runLookups(t, [rule({ tieBreak: prefer() })], { sources });
    expect(last(t)).toMatchObject({ Doctor: 'Dr Rao', Status: 'Ambiguous' });
  });

  it('"Check Up" is not preferred either', () => {
    const t = make([['B', 'U1', '2026-10-05', 'Dr Rao', 'X', null], ['B', 'U1', '2026-10-05', 'Master Health Check Up', 'X', null]]);
    runLookups(t, [rule({ tieBreak: prefer() })], { sources });
    expect(last(t).Doctor).toBe('Dr Rao');
  });

  it('two real doctors on one day: "then first" takes the first, "then unattributed" writes the not-found value; both Ambiguous', () => {
    const two = [['B', 'U1', '2026-10-05', 'Dr One', 'D1', null], ['B', 'U1', '2026-10-05', 'Dr Two', 'D2', null]];
    const a = make(two);
    runLookups(a, [rule({ tieBreak: prefer('first') })], { sources });
    expect(last(a)).toMatchObject({ Doctor: 'Dr One', Dept: 'D1', Status: 'Ambiguous' });

    const b = make(two);
    const r = runLookups(b, [rule({ tieBreak: prefer('unattributed') })], { sources });
    expect(last(b)).toMatchObject({ Doctor: 'Unattributed', Dept: 'Unattributed', Status: 'Ambiguous' });
    expect(r.results[0]?.byStatus).toEqual({ Matched: 0, Fallback: 0, Ambiguous: 1, Unattributed: 0 });
  });

  it('tie-break "first" and "unattributed" on their own; no tie-break means the first, still Ambiguous', () => {
    const two = [['B', 'U1', '2026-10-05', 'Dr Two', 'D2', null], ['B', 'U1', '2026-10-05', 'Dr One', 'D1', null]];
    const first = make(two);
    runLookups(first, [rule({ tieBreak: { method: 'first', then: 'first' } })], { sources });
    expect(last(first)).toMatchObject({ Doctor: 'Dr Two', Status: 'Ambiguous' });
    const none = make(two);
    runLookups(none, [rule()], { sources });
    expect(last(none)).toMatchObject({ Doctor: 'Dr Two', Status: 'Ambiguous' });
    const un = make(two);
    runLookups(un, [rule({ tieBreak: { method: 'unattributed', then: 'first' } })], { sources });
    expect(last(un)).toMatchObject({ Doctor: 'Unattributed', Status: 'Ambiguous' });
  });

  it('Matched only when exactly one value is on the chosen day', () => {
    // the same doctor twice on the day (even spelled differently in case): one value → Matched
    const same = make([['B', 'U1', '2026-10-05', 'Dr Rao', 'D', null], ['B', 'U1', '2026-10-05', 'DR RAO', 'D', null]]);
    runLookups(same, [rule({ tieBreak: prefer() })], { sources });
    expect(last(same).Status).toBe('Matched');
    // an earlier day with another doctor is not a tie: the latest day wins
    const later = make([['B', 'U1', '2026-10-01', 'Dr One', 'D1', null], ['B', 'U1', '2026-10-05', 'Dr Two', 'D2', null]]);
    runLookups(later, [rule({ tieBreak: prefer() })], { sources });
    expect(last(later)).toMatchObject({ Doctor: 'Dr Two', Status: 'Matched' });
  });

  it('a tie on the nearest LATER day is Ambiguous too (it would otherwise be Fallback)', () => {
    const t = make([['B', 'U1', '2026-10-09', 'Dr One', 'D1', null], ['B', 'U1', '2026-10-09', 'Dr Two', 'D2', null]]);
    runLookups(t, [rule({ tieBreak: prefer() })], { sources });
    expect(last(t)).toMatchObject({ Doctor: 'Dr One', Status: 'Ambiguous' });
    const one = make([['B', 'U1', '2026-10-09', 'Dr One', 'D1', null]]);
    runLookups(one, [rule({ tieBreak: prefer() })], { sources });
    expect(last(one).Status).toBe('Fallback');
  });

  it('compares calendar days: a time of day on either side does not change the answer', () => {
    // consultation at 10:30 on the 6th, bill on the 6th: same day = on or before (comparing the text would say "after")
    const t = make([['B', 'U1', '2026-10-06T10:30:00', 'Dr One', 'D1', null]], [['A', 'U1', '2026-10-06', null, null, 500], ['A', 'U1', '2026-10-06T08:00:00', null, null, 700]]);
    runLookups(t, [rule({ tieBreak: prefer() })], { sources });
    expect(t.rows.slice(1).map((r) => [r.Doctor, r.Status])).toEqual([['Dr One', 'Matched'], ['Dr One', 'Matched']]);
    // two consultations on one day with different times are still one day, so a tie
    const tie = make([['B', 'U1', '2026-10-05T09:00:00', 'Dr One', 'D1', null], ['B', 'U1', '2026-10-05T17:45:00', 'Dr Two', 'D2', null]]);
    runLookups(tie, [rule({ tieBreak: { method: 'first', then: 'first' } })], { sources });
    expect(last(tie)).toMatchObject({ Doctor: 'Dr One', Status: 'Ambiguous' });
  });

  it('the tie-break formula is checked: an unknown column is an error that names it', () => {
    const t = make(SAME_DAY);
    const r = runLookups(t, [rule({ tieBreak: { method: 'preferNotMatching', preferFormula: 'NOT(CONTAINS([Nope],"x"))', then: 'first' } })], { sources });
    expect(r.issues[0]).toMatchObject({ level: 'error', column: 'Nope' });
    expect(runLookups(make(SAME_DAY), [rule({ tieBreak: { method: 'preferNotMatching', preferFormula: 'AND(', then: 'first' } })], { sources }).issues[0]?.message).toMatch(/tie-break formula is not valid/);
  });

  it('the rule validates: a tie-break needs a known method', () => {
    const base = { label: 'L', target: { source: 'a', column: 'Doctor', key: 'K' }, from: { source: 'b', key: 'K', value: 'Doctor' }, pick: 'latestOnOrBefore', notFoundValue: 'x' };
    expect(LookupRuleSchema.safeParse(base).success).toBe(true);
    expect(LookupRuleSchema.safeParse({ ...base, tieBreak: { method: 'preferNotMatching', preferFormula: DEFAULT_TIE_BREAK_FORMULA, then: 'first' } }).success).toBe(true);
    expect(LookupRuleSchema.safeParse({ ...base, tieBreak: { method: 'random', then: 'first' } }).success).toBe(false);
  });

  it('the Checks report Ambiguous rows with their count and amount', () => {
    const t = make(SAME_DAY, [['A', 'U1', '2026-10-06', null, null, 123456], ['A', 'U1', '2026-10-06', null, null, 100]]);
    const { results } = runLookups(t, [rule({ tieBreak: prefer() })], { sources });
    const checks = buildChecks({
      recipe: { sources: [], checks: { tieOuts: [] } },
      issues: [],
      sources: [],
      combinedRows: t.rows.length,
      cleanup: [],
      lookups: results,
      report: null,
    });
    const main = checks.find((c) => c.title === 'Lookup: L');
    expect(main?.message).toContain('2 ambiguous (₹1,235.56)');
    const amb = checks.find((c) => c.title === 'Lookup: L: ambiguous');
    expect(amb).toMatchObject({ level: 'warning', rows: 2, amountPaise: 123556 });
    expect(amb?.details?.[0]?.text).toBe('U1 on 2026-10-06: General Consultation / Dr Rao → written: Dr Rao');
  });

  it('no ambiguous check when there is no tie', () => {
    const t = make([['B', 'U1', '2026-10-05', 'Dr One', 'D1', null]]);
    const { results } = runLookups(t, [rule({ tieBreak: prefer() })], { sources });
    const checks = buildChecks({ recipe: { sources: [], checks: { tieOuts: [] } }, issues: [], sources: [], combinedRows: 2, cleanup: [], lookups: results, report: null });
    expect(checks.some((c) => c.title.endsWith(': ambiguous'))).toBe(false);
  });
});

// ---- 3. report ------------------------------------------------------------------------------------------------------

describe('report: hide rows where all aggregate columns are 0', () => {
  const t = table(
    ['Doctor', 'Source', 'Amount', 'Visits'],
    [
      ['Dr A', 'X', 10000, 1],
      ['Dr B', 'X', 5000, 1], //   B nets to zero money (Net), but has Revenue from X, so it stays
      ['Dr B', 'Y', -5000, null],
      ['Dr C', 'Y', null, null], // C has only blanks
      ['Dr D', 'X', 2500, null],
    ],
    { Amount: 'money', Visits: 'number' },
  );
  const def = (hideZeroRows?: boolean) => ({
    groupBy: ['Doctor'],
    totalsRow: true,
    ...(hideZeroRows === undefined ? {} : { hideZeroRows }),
    columns: [
      { kind: 'serial' as const, name: 'S.No.' },
      { kind: 'group' as const, name: 'Doctor', from: 'Doctor' },
      { kind: 'aggregate' as const, name: 'Revenue', agg: 'SUM' as const, of: 'Amount', where: '[Source]="X"', type: 'money' as const },
      { kind: 'aggregate' as const, name: 'Net', agg: 'SUM' as const, of: 'Amount', type: 'money' as const },
      { kind: 'aggregate' as const, name: 'Visits', agg: 'SUM' as const, of: 'Visits', type: 'number' as const },
      { kind: 'formula' as const, name: 'Double', formula: '[Net]*2', type: 'money' as const },
    ],
  });

  it('is off unless asked for', () => {
    const r = buildReport(t, def());
    expect(r.rows.map((x) => x.Doctor)).toEqual(['Dr A', 'Dr B', 'Dr C', 'Dr D']);
    expect(r.hidden).toEqual([]);
  });

  it('leaves out only the rows whose aggregate columns are all 0 or blank, renumbers, and lists them', () => {
    const r = buildReport(t, def(true));
    // B: Revenue 5000, so it stays (only Net and Visits are 0 there); C has only blanks; A and D have money
    expect(r.rows.map((x) => [x['S.No.'], x.Doctor])).toEqual([[1, 'Dr A'], [2, 'Dr B'], [3, 'Dr D']]);
    expect(r.hidden).toEqual([{ label: 'Dr C', combinedRows: 1 }]);
    expect(r.inputRows).toBe(5);
  });

  it('a row that nets to exactly zero everywhere is hidden, and the totals still count every row', () => {
    const z = table(
      ['Doctor', 'Source', 'Amount'],
      [['Dr A', 'X', 10000], ['Dr B', 'X', 5000], ['Dr B', 'X', -5000], ['Dr C', 'X', null]],
      { Amount: 'money' },
    );
    const cols = [
      { kind: 'group' as const, name: 'Doctor', from: 'Doctor' },
      { kind: 'aggregate' as const, name: 'Revenue', agg: 'SUM' as const, of: 'Amount', type: 'money' as const },
      { kind: 'aggregate' as const, name: 'Bills', agg: 'COUNT' as const, where: '[Amount]>0', type: 'number' as const },
    ];
    const r = buildReport(z, { groupBy: ['Doctor'], totalsRow: true, hideZeroRows: true, columns: cols });
    // Dr B has a bill (COUNT 1), so it stays; Dr C has 0 revenue and 0 bills
    expect(r.rows.map((x) => x.Doctor)).toEqual(['Dr A', 'Dr B']);
    expect(r.hidden).toEqual([{ label: 'Dr C', combinedRows: 1 }]);
    const only = buildReport(z, { groupBy: ['Doctor'], totalsRow: true, hideZeroRows: true, columns: cols.slice(0, 2) });
    expect(only.rows.map((x) => x.Doctor)).toEqual(['Dr A']);
    expect(only.hidden.map((h) => h.label)).toEqual(['Dr B', 'Dr C']); // B nets to 0, C is blank
    expect(only.hidden[0]).toEqual({ label: 'Dr B', combinedRows: 2 });
    expect(only.totals?.Revenue).toBe(10000); // totals are built from every combined row
  });

  it('a report with no aggregate column is never emptied', () => {
    const r = buildReport(t, { groupBy: ['Doctor'], totalsRow: false, hideZeroRows: true, columns: [{ kind: 'group', name: 'Doctor', from: 'Doctor' }] });
    expect(r.rows).toHaveLength(4);
    expect(r.hidden).toEqual([]);
  });

  it('the Checks list every hidden row, with how many combined rows it holds', () => {
    const r = buildReport(t, def(true));
    const checks = buildChecks({ recipe: { sources: [], checks: { tieOuts: [] } }, issues: [], sources: [], combinedRows: 5, cleanup: [], lookups: [], report: r });
    const hidden = checks.find((c) => c.title.startsWith('Report rows hidden'));
    expect(hidden).toMatchObject({ level: 'info', rows: 1 });
    expect(hidden?.details).toEqual([{ text: 'Dr C (1 combined row)' }]);
    expect(buildChecks({ recipe: { sources: [], checks: { tieOuts: [] } }, issues: [], sources: [], combinedRows: 5, cleanup: [], lookups: [], report: buildReport(t, def()) }).some((c) => c.title.startsWith('Report rows hidden'))).toBe(false);
  });

  it('lists more than the usual 25 examples', () => {
    const many = table(['Doctor', 'Amount'], [['Dr Real', 100], ...Array.from({ length: 60 }, (_, i) => [`Dr Zero ${i}`, 0])], { Amount: 'money' });
    const r = buildReport(many, { groupBy: ['Doctor'], totalsRow: false, hideZeroRows: true, columns: [{ kind: 'group', name: 'Doctor', from: 'Doctor' }, { kind: 'aggregate', name: 'Revenue', agg: 'SUM', of: 'Amount', type: 'money' }] });
    expect(r.hidden).toHaveLength(60);
    const hidden = buildChecks({ recipe: { sources: [], checks: { tieOuts: [] } }, issues: [], sources: [], combinedRows: 61, cleanup: [], lookups: [], report: r }).find((c) => c.title.startsWith('Report rows hidden'));
    expect(hidden?.details).toHaveLength(60);
    expect(hidden?.detailLimit).toBeGreaterThanOrEqual(60);
  });
});
