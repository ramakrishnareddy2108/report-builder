// Checks on a run: Pass / Warning / Fail.
//
// A Fail blocks Final. A Warning needs a typed note before the run can be Final.
// Every check reports numbers and example rows in plain language. Checks that
// find nothing wrong are still listed as Pass, so the user can see what was looked at.

import { pivot, sumFacts, totalValues } from './aggregate';
import { formatINR } from './money';
import type { RulesFile } from './schemas';
import type { RunDiagnostics, RowExample, SourceDiag, TermStat } from './runTypes';
import { SOURCE_LABELS, type CheckLevel, type CheckResult, type DoctorMaster, type FactRow, type MeasureCode, type SourceId } from './types';
import { SKIP_REASON_LABELS, type SkipReason } from '@/excel/mapSource';
import { plural } from '@/lib/plural';

/** Amounts within one rupee are treated as equal (paise). */
export const TOLERANCE_PAISE = 100;

/** The previous Final month, for the change check. */
export type PreviousMonth = { month: string; facts: readonly FactRow[] };

export type CheckInput = {
  month: string;
  rules: RulesFile;
  doctors: readonly DoctorMaster[];
  diagnostics: RunDiagnostics;
  facts: readonly FactRow[];
  previous: PreviousMonth | null;
  /** Other loaded files identical to a used one (found on the Run page). */
  duplicateLoadedFiles?: RunDiagnostics['duplicateFiles'];
};

const label = (id: SourceId) => SOURCE_LABELS[id];
const rupees = (paise: number) => formatINR(paise);
const toExample = (e: RowExample) => ({ sourceFile: e.sourceFile, sourceRow: e.sourceRow, ref: e.ref });

type Extra = Partial<Pick<CheckResult, 'rows' | 'amountPaise' | 'examples' | 'details'>>;

function make(id: string, title: string, level: CheckLevel, message: string, extra: Extra = {}): CheckResult {
  return { id, level, title, message, examples: [], ...extra };
}

/** Pass with a message when there is nothing to report, otherwise the given level. */
function judge(id: string, title: string, problem: boolean, level: 'Warning' | 'Fail', ok: string, bad: string, extra: Extra = {}): CheckResult {
  return problem ? make(id, title, level, bad, extra) : make(id, title, 'Pass', ok);
}

const sum = (values: Iterable<number>) => {
  let n = 0;
  for (const v of values) n += v;
  return n;
};

const needed = (d: RunDiagnostics) => d.sources.filter((s) => s.needed);

// ---------------------------------------------------------------------------
// Fail checks
// ---------------------------------------------------------------------------

function sourcesPresent(d: RunDiagnostics): CheckResult {
  const missing = needed(d).filter((s) => s.status === 'missing');
  return judge(
    'sources-present',
    'All source files are loaded',
    missing.length > 0,
    'Fail',
    `All ${needed(d).length} source files the rules use are loaded.`,
    `${plural(missing.length, 'source file')} missing: ${missing.map((s) => label(s.sourceId)).join(', ')}. Load ${missing.length === 1 ? 'it' : 'them'} on the Sources page.`,
    { details: missing.map((s) => label(s.sourceId)) },
  );
}

function sourcesFit(d: RunDiagnostics): CheckResult {
  const flagged = d.sources.filter((s) => s.status === 'flagged');
  return judge(
    'sources-fit-mapping',
    'Every file fits its saved mapping',
    flagged.length > 0,
    'Fail',
    'Every loaded file has the columns, sheet and formulas its mapping needs.',
    `${plural(flagged.length, 'file')} no longer fit${flagged.length === 1 ? 's' : ''} the saved mapping. Nothing was read from ${flagged.length === 1 ? 'it' : 'them'}. Fix the mapping on the Sources page.`,
    { details: flagged.flatMap((s) => s.problems.map((p) => `${label(s.sourceId)}: ${p.message}`)) },
  );
}

function ruleFormulas(d: RunDiagnostics): CheckResult {
  return judge(
    'rule-formulas',
    'Measure rules can be read',
    d.ruleProblems.length > 0,
    'Fail',
    'Every measure rule formula is valid.',
    `${plural(d.ruleProblems.length, 'rule formula')} could not be used, so those measures are incomplete.`,
    { details: d.ruleProblems },
  );
}

function unreadableAmounts(d: RunDiagnostics): CheckResult {
  const terms = d.terms.filter((t) => t.badAmount.count > 0);
  const rows = sum(terms.map((t) => t.badAmount.count));
  return judge(
    'unreadable-amounts',
    'Amounts can be read',
    rows > 0,
    'Fail',
    'Every amount the rules use could be read.',
    `${plural(rows, 'row')} ${rows === 1 ? 'has' : 'have'} an amount that cannot be read, so ${rows === 1 ? 'it was' : 'they were'} left out of the report. Correct the file and load it again.`,
    {
      rows,
      examples: terms.flatMap((t) => t.badAmount.examples).slice(0, 10).map(toExample),
      details: terms.map((t) => `${t.measure} from ${label(t.sourceId)}: ${plural(t.badAmount.count, 'row')}`),
    },
  );
}

function filterErrors(d: RunDiagnostics): CheckResult {
  const mapping = d.sources.flatMap((s) => (s.skipped.filterError.count > 0 ? [{ s, c: s.skipped.filterError }] : []));
  const terms = d.terms.filter((t) => t.filterError.count > 0);
  const rows = sum(mapping.map((m) => m.c.count)) + sum(terms.map((t) => t.filterError.count));
  return judge(
    'row-filter-errors',
    'Row filters work on every row',
    rows > 0,
    'Fail',
    'Every row filter could be evaluated on every row.',
    `A row filter could not be evaluated for ${plural(rows, 'row')}, so ${rows === 1 ? 'it was' : 'they were'} left out.`,
    {
      rows,
      examples: [...mapping.flatMap((m) => m.c.examples), ...terms.flatMap((t) => t.filterError.examples)].slice(0, 10).map(toExample),
    },
  );
}

function duplicateFiles(d: RunDiagnostics, extra: RunDiagnostics['duplicateFiles'] = []): CheckResult {
  const all = [...d.duplicateFiles, ...extra];
  return judge(
    'duplicate-files',
    'No file is used twice',
    all.length > 0,
    'Fail',
    'No file was loaded twice.',
    `The same file was loaded more than once (${all.map((f) => f.fileNames.map((n) => `“${n}”`).join(' and ')).join('; ')}). Remove the extra copy so a month is never counted twice.`,
    { details: all.map((f) => f.fileNames.join(' = ')) },
  );
}

function duplicateRefs(d: RunDiagnostics): CheckResult {
  const dups = d.sources.filter((s) => s.duplicateRefs.rows > 0);
  const rows = sum(dups.map((s) => s.duplicateRefs.rows));
  return judge(
    'duplicate-refs',
    'Bill and admission numbers are unique',
    rows > 0,
    'Fail',
    'No bill, admission or consultation number appears twice where it should be unique.',
    `${plural(rows, 'row')} share a number that should appear once, so ${rows === 1 ? 'it' : 'they'} may be counted twice. If a source legitimately repeats numbers (like pharmacy items), switch off “appears once” in its mapping.`,
    {
      rows,
      examples: dups.flatMap((s) => s.duplicateRefs.examples.map((e) => ({ sourceFile: s.fileName ?? label(s.sourceId), sourceRow: e.rows[0] as number, ref: e.ref }))).slice(0, 10),
      details: dups.map((s) => `${label(s.sourceId)}: ${plural(s.duplicateRefs.rows, 'row')} (for example ${s.duplicateRefs.examples.map((e) => `${e.ref} on rows ${e.rows.join(' and ')}`).join('; ')})`),
    },
  );
}

/** The file's own grand-total row against the sum of its rows. */
function sourceTotals(d: RunDiagnostics): CheckResult {
  const mismatches: { source: SourceDiag; field: string; fileTotal: number; rowTotal: number }[] = [];
  for (const s of d.sources) {
    for (const [field, fileTotal] of Object.entries(s.footerTotals) as [string, number][]) {
      const rowTotal = s.fieldTotals[field as keyof typeof s.fieldTotals] ?? 0;
      if (Math.abs(fileTotal - rowTotal) > TOLERANCE_PAISE) mismatches.push({ source: s, field, fileTotal, rowTotal });
    }
  }
  return judge(
    'source-totals',
    'File totals match their rows',
    mismatches.length > 0,
    'Fail',
    'Where a file has its own grand-total row, it matches the sum of its rows.',
    `${plural(mismatches.length, 'file total')} differ${mismatches.length === 1 ? 's' : ''} from the sum of the rows read (by more than ₹1). Some rows may have been missed or changed.`,
    {
      details: mismatches.map(
        (m) => `${label(m.source.sourceId)} ${m.field}: the file says ${rupees(m.fileTotal)}, its rows add up to ${rupees(m.rowTotal)}`,
      ),
    },
  );
}

/** What the sources contributed against what the report holds, per measure. */
function reportTies(d: RunDiagnostics, facts: readonly FactRow[]): CheckResult {
  const fromSources = new Map<MeasureCode, number>();
  for (const t of d.terms) fromSources.set(t.measure, (fromSources.get(t.measure) ?? 0) + t.sumPaise);

  const inFacts = sumFacts(facts);
  const report = totalValues(pivot(facts, 'doctor'));
  const lines: string[] = [];
  for (const [measure, source] of fromSources) {
    const reportTotal = report[measure];
    if (Math.abs(source - reportTotal) > TOLERANCE_PAISE || Math.abs(source - (inFacts[measure] ?? 0)) > TOLERANCE_PAISE) {
      lines.push(`${measure}: sources gave ${rupees(source)}, the report has ${rupees(reportTotal)}`);
    }
  }
  return judge(
    'report-ties-to-sources',
    'Report totals match the sources',
    lines.length > 0,
    'Fail',
    'For every measure, the report total equals what the source files contributed (within ₹1).',
    `${plural(lines.length, 'measure')} in the report ${lines.length === 1 ? 'does' : 'do'} not match the source total by more than ₹1.`,
    { details: lines },
  );
}

// ---------------------------------------------------------------------------
// Warning checks
// ---------------------------------------------------------------------------

function unknownDoctors(d: RunDiagnostics): CheckResult {
  const list = d.unmatchedDoctors;
  const rows = sum(list.map((u) => u.rows));
  return judge(
    'unknown-doctors',
    'Every doctor name is in the doctor list',
    list.length > 0,
    'Warning',
    'Every doctor name in the files is in the doctor list.',
    `${plural(list.length, 'doctor name')} (${plural(rows, 'row')}) ${list.length === 1 ? 'is' : 'are'} not in the doctor list. The amounts are kept in an “Unmatched doctor” line. Add ${list.length === 1 ? 'the name' : 'the names'} on the Doctors page.`,
    {
      rows,
      details: list.map((u) => `${u.raw}: ${plural(u.rows, 'row')} in ${u.sources.map(label).join(', ')}${u.ambiguous ? ' (two doctors claim this spelling)' : ''}`),
    },
  );
}

function pharmacyAttribution(facts: readonly FactRow[]): CheckResult {
  // OP_PHARMACY only, so a row is not counted again for its cost.
  const rows = facts.filter((f) => f.measure === 'OP_PHARMACY' && f.attributionStatus !== undefined);
  const count = (status: string) => rows.filter((f) => f.attributionStatus === status);
  const fallback = count('Fallback');
  const unattributed = count('Unattributed');
  const bad = fallback.length + unattributed.length;
  const amount = (list: FactRow[]) => sum(list.map((f) => f.amountPaise));
  return judge(
    'pharmacy-attribution',
    'Pharmacy rows are linked to a doctor',
    bad > 0,
    'Warning',
    `All ${plural(rows.length, 'OP pharmacy row')} were matched to a doctor through one consultation.`,
    `Of ${plural(rows.length, 'OP pharmacy row')}, ${plural(fallback.length, 'row')} used a best guess between several consultations (Fallback) and ${plural(unattributed.length, 'row')} had no consultation (shown under “Pharmacy – Unattributed”).`,
    {
      rows: bad,
      amountPaise: amount(fallback) + amount(unattributed),
      details: [
        `Matched: ${plural(count('Matched').length, 'row')}, ${rupees(amount(count('Matched')))}`,
        `Fallback: ${plural(fallback.length, 'row')}, ${rupees(amount(fallback))}`,
        `Unattributed: ${plural(unattributed.length, 'row')}, ${rupees(amount(unattributed))}`,
      ],
      examples: [...fallback, ...unattributed].slice(0, 10).map((f) => ({ sourceFile: f.sourceFile, sourceRow: f.sourceRow, ref: f.ref })),
    },
  );
}

function ipViaOpPharmacy(d: RunDiagnostics): CheckResult {
  const terms = d.terms.filter((t) => t.ipViaOp.count > 0);
  // One source row feeds both OP_PHARMACY and its cost; count the rows once, through the sales measure.
  const sales = terms.filter((t) => t.measure === 'OP_PHARMACY');
  const rows = sum(sales.map((t) => t.ipViaOp.count));
  const amountPaise = sum(sales.map((t) => t.ipViaOp.amountPaise));
  return make(
    'ip-via-op-pharmacy',
    'In-patients at the OP pharmacy counter',
    'Pass',
    rows === 0
      ? 'No OP pharmacy row belongs to an in-patient.'
      : `${plural(rows, 'OP pharmacy row')} belong to in-patients (admission number filled). They are not part of OP Pharmacy; the net sales amount is ${rupees(amountPaise)}. For information only.`,
    {
      rows,
      amountPaise,
      details: terms.map((t) => `${t.measure} from ${label(t.sourceId)}: ${plural(t.ipViaOp.count, 'row')}, ${rupees(t.ipViaOp.amountPaise)}`),
      examples: terms.flatMap((t) => t.ipViaOp.examples).slice(0, 5).map(toExample),
    },
  );
}

function opOverlap(d: RunDiagnostics, rules: RulesFile): CheckResult {
  const { pairs, examples } = d.opOverlap;
  const added = rules.flags.includeConsultations;
  if (pairs === 0) return make('op-overlap', 'OP Billing and Consultations do not overlap', 'Pass', 'No patient appears on the same day in both OP Billing and OP Consultations.');
  if (!added) {
    return make(
      'op-overlap',
      'OP Billing and Consultations overlap',
      'Pass',
      `${plural(pairs, 'patient visit')} appear in both OP Billing and OP Consultations. Consultations are not added to OP Revenue, so nothing is counted twice.`,
    );
  }
  return make(
    'op-overlap',
    'OP Billing and Consultations overlap',
    'Warning',
    `${plural(pairs, 'patient visit')} appear in both OP Billing and OP Consultations, and consultations are being added to OP Revenue. Those visits may be counted twice.`,
    { rows: pairs, details: examples },
  );
}

function datesOutsideMonth(d: RunDiagnostics): CheckResult {
  const outside = d.terms.filter((t) => t.outsideMonth.count > 0);
  const missing = d.terms.filter((t) => t.noDate.count > 0);
  const rows = sum(outside.map((t) => t.outsideMonth.count)) + sum(missing.map((t) => t.noDate.count));
  return judge(
    'dates-outside-month',
    'All rows are dated in the month',
    rows > 0,
    'Warning',
    `Every row is dated in ${d.month}.`,
    `${plural(rows, 'row')} ${rows === 1 ? 'is' : 'are'} dated outside ${d.month} or ${rows === 1 ? 'has' : 'have'} no readable date. They are still counted. Check that the right month's files were loaded.`,
    {
      rows,
      examples: [...outside.flatMap((t) => t.outsideMonth.examples), ...missing.flatMap((t) => t.noDate.examples)].slice(0, 10).map(toExample),
      details: [
        ...outside.map((t) => `${t.measure} from ${label(t.sourceId)}: ${plural(t.outsideMonth.count, 'row')} outside the month`),
        ...missing.map((t) => `${t.measure} from ${label(t.sourceId)}: ${plural(t.noDate.count, 'row')} with no readable date`),
      ],
    },
  );
}

function unreadableUnused(d: RunDiagnostics): CheckResult {
  const list = d.sources.filter((s) => s.unreadableUnused.count > 0);
  const rows = sum(list.map((s) => s.unreadableUnused.count));
  return judge(
    'unreadable-other-cells',
    'Other columns can be read',
    rows > 0,
    'Warning',
    'Every mapped column the rules do not use could be read too.',
    `${plural(rows, 'cell')} in mapped columns that no rule uses could not be read. They do not change the report.`,
    {
      rows,
      examples: list.flatMap((s) => s.unreadableUnused.examples).slice(0, 10).map(toExample),
      details: list.map((s) => `${label(s.sourceId)}: ${plural(s.unreadableUnused.count, 'cell')}`),
    },
  );
}

/** Doctor and department Total Revenue against the previous Final month. */
function changeVsPrevious(input: CheckInput): CheckResult {
  const { previous, rules, month } = input;
  const title = 'Doctors and departments against last month';
  if (!previous) return make('change-vs-previous', title, 'Pass', 'There is no earlier Final month to compare with yet.');

  const { changePercent, minChangePaise } = rules.thresholds;
  const names = new Map(input.doctors.map((d) => [d.id, d.displayName]));
  const lines: string[] = [];

  const compare = (kind: string, now: Map<string, number>, before: Map<string, number>, name: (k: string) => string) => {
    for (const key of new Set([...now.keys(), ...before.keys()])) {
      const a = now.get(key) ?? 0;
      const b = before.get(key) ?? 0;
      if (Math.max(Math.abs(a), Math.abs(b)) < minChangePaise) continue;
      const changed = b === 0 ? Infinity : (Math.abs(a - b) / Math.abs(b)) * 100;
      if (changed > changePercent) {
        const how = b === 0 ? 'new this month' : `${a > b ? 'up' : 'down'} ${Math.round(changed)}%`;
        lines.push(`${kind} ${name(key)}: ${how} (${rupees(b)} in ${previous.month}, ${rupees(a)} in ${month})`);
      }
    }
  };
  const revenue = (facts: readonly FactRow[], by: 'doctor' | 'department') =>
    new Map(pivot(facts, by).map((r) => [r.key, r.values.TOTAL_REVENUE]));

  compare('Doctor', revenue(input.facts, 'doctor'), revenue(previous.facts, 'doctor'), (k) => names.get(k) ?? k);
  compare('Department', revenue(input.facts, 'department'), revenue(previous.facts, 'department'), (k) => k);

  return judge(
    'change-vs-previous',
    title,
    lines.length > 0,
    'Warning',
    `No doctor or department's Total Revenue moved by more than ${changePercent}% against ${previous.month}.`,
    `${plural(lines.length, 'doctor or department')} moved by more than ${changePercent}% in Total Revenue against ${previous.month}. Check that this is real.`,
    { rows: lines.length, details: lines },
  );
}

// ---------------------------------------------------------------------------
// Information: rows that were not used
// ---------------------------------------------------------------------------

function rowsNotUsed(d: RunDiagnostics): CheckResult {
  const details: string[] = [];
  const examples: RowExample[] = [];
  let rows = 0;
  for (const s of d.sources.filter((x) => x.status === 'read')) {
    for (const reason of Object.keys(SKIP_REASON_LABELS) as SkipReason[]) {
      const counted = s.skipped[reason];
      if (counted.count === 0) continue;
      rows += counted.count;
      details.push(`${label(s.sourceId)}: ${plural(counted.count, 'row')} skipped. ${SKIP_REASON_LABELS[reason]}`);
      if (reason === 'noReference') examples.push(...counted.examples);
    }
  }
  for (const t of d.terms.filter((x: TermStat) => x.filtered > 0)) {
    rows += t.filtered;
    details.push(`${t.measure} from ${label(t.sourceId)}: ${plural(t.filtered, 'row')} left out by the rule's filter`);
  }
  return make(
    'rows-not-used',
    'Rows that were not used',
    'Pass',
    rows === 0 ? 'Every row of every file was used.' : `${plural(rows, 'row')} ${rows === 1 ? 'was' : 'were'} not used, each for a reason listed below. For information only.`,
    { rows, details, examples: examples.slice(0, 5).map(toExample) },
  );
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Every check, in a fixed order. */
export function runChecks(input: CheckInput): CheckResult[] {
  const d = input.diagnostics;
  return [
    sourcesPresent(d),
    sourcesFit(d),
    ruleFormulas(d),
    unreadableAmounts(d),
    filterErrors(d),
    duplicateFiles(d, input.duplicateLoadedFiles),
    duplicateRefs(d),
    sourceTotals(d),
    reportTies(d, input.facts),
    unknownDoctors(d),
    pharmacyAttribution(input.facts),
    opOverlap(d, input.rules),
    datesOutsideMonth(d),
    unreadableUnused(d),
    changeVsPrevious(input),
    ipViaOpPharmacy(d),
    rowsNotUsed(d),
  ];
}

export function countByLevel(checks: readonly CheckResult[]): Record<CheckLevel, number> {
  const out: Record<CheckLevel, number> = { Pass: 0, Warning: 0, Fail: 0 };
  for (const c of checks) out[c.level]++;
  return out;
}

/** Can this run be made Final? Needs zero Fails and a typed note on every Warning. */
export function finalBlockers(checks: readonly CheckResult[]): string[] {
  const reasons: string[] = [];
  for (const c of checks) {
    if (c.level === 'Fail') reasons.push(`Fix: ${c.title}`);
    else if (c.level === 'Warning' && (c.note ?? '').trim() === '') reasons.push(`Add a note to the warning: ${c.title}`);
  }
  return reasons;
}

/** The checks with the user's notes attached (by check id). */
export function withNotes(checks: readonly CheckResult[], notes: Readonly<Record<string, string>>): CheckResult[] {
  return checks.map((c) => {
    const note = notes[c.id]?.trim();
    return note ? { ...c, note } : c;
  });
}
