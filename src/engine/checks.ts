// Pipeline step 9: the Checks shown after every Generate run.
//
// Nothing is dropped silently: every row left out, every value that could not be read, every lookup that found
// nothing, and every name left over after cleanup is counted here, with a reason.
//
// Levels: error (blocks the download), warning (shown), info (shown, collapsed).

import { formatINR } from '@/core/money';
import type { Recipe, TieOut } from '@/recipe/schema';
import type { CleanupReport } from './cleanup';
import type { LookupResult } from './lookups';
import type { ReportResult } from './report';
import type { Issue, IssueLevel, SourceSummary, Typed } from './types';

export type CheckDetail = { file?: string; row?: number; text: string };

export type Check = {
  level: IssueLevel;
  title: string;
  message: string;
  /** Number of rows the check is about. */
  rows?: number;
  /** Money involved, in integer paise. */
  amountPaise?: number;
  /** Examples with the file and Excel row, so the user can find them. */
  details?: CheckDetail[];
  /** How many details to show (default 25). A check that lists everything it left out raises it. */
  detailLimit?: number;
  sourceId?: string;
  column?: string;
};

export type ChecksInput = {
  recipe: Pick<Recipe, 'sources' | 'checks'>;
  /** Everything that went wrong or was noted before this step (read, combine, cleanup, lookups, report). */
  issues: readonly Issue[];
  sources: readonly SourceSummary[];
  combinedRows: number;
  cleanup: readonly CleanupReport[];
  lookups: readonly LookupResult[];
  report: ReportResult | null;
  /** Uploaded files that no source used. */
  ignoredFiles?: readonly string[];
  /** Notes from filling the template (including the formula cross-check). */
  templateNotes?: readonly { level: IssueLevel; message: string }[];
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;
const MAX_DETAILS = 25;
/** The most hidden report rows listed one by one in the Checks (a cell of the Checks sheet holds 32,767 characters). */
const MAX_HIDDEN_LISTED = 300;

/** The value of a tie-out: rupees as a plain number. */
function rupees(v: number | null, money: boolean): number | null {
  return v === null ? null : money ? v / 100 : v;
}

function tieOutCheck(t: TieOut, input: ChecksInput): Check {
  const title = `Tie-out: ${t.label}`;
  const level = t.level ?? 'warning';
  const ids = [t.source, ...(t.alsoSources ?? [])];

  // the source(s) and their total, each in rupees (a count stays a count)
  const labels: string[] = [];
  let sourceMoney = false;
  let sourceValue = 0;
  const details: CheckDetail[] = [];
  for (const id of ids) {
    const def = input.recipe.sources.find((s) => s.id === id);
    const summary = input.sources.find((s) => s.sourceId === id);
    if (!def) return { level: 'warning', title, message: `The source “${id}” of this tie-out is not in the recipe.` };
    if (!summary) return { level: 'warning', title, message: `${def.label} has no file this time, so its total cannot be compared.`, sourceId: id };
    labels.push(def.label);

    const columnDef =
      def.columns.find((c) => c.as.toUpperCase() === t.column.toUpperCase() || c.from.toUpperCase() === t.column.toUpperCase()) ??
      def.calculated.find((c) => c.as.toUpperCase() === t.column.toUpperCase());
    const asName = columnDef ? ('as' in columnDef ? columnDef.as : t.column) : t.column;
    const isMoney = columnDef?.type === 'money';
    sourceMoney ||= isMoney;

    if (t.totalFrom === 'rows') {
      const total = summary.totals[asName];
      if (typeof total !== 'number') return { level: 'warning', title, message: `${def.label} has no number column “${asName}” to add up, so its total could not be compared with the report.`, sourceId: id };
      sourceValue += rupees(total, isMoney) ?? 0;
      details.push({ file: summary.fileName, text: `${def.label}: ${asName} added up over the ${plural(summary.stats.used, 'row')} used: ${formatTotal(total, isMoney)}` });
    } else {
      const footer = [...summary.footerRows].reverse().find((r) => typeof r.values[asName] === 'number');
      if (!footer) {
        return { level: 'warning', title, message: `No total row was found at the end of ${def.label}, so ${asName} could not be compared with the report.`, sourceId: id };
      }
      sourceValue += rupees(footer.values[asName] as number, isMoney) ?? 0;
      details.push({ file: summary.fileName, row: footer.row, text: `${asName} total in ${def.label}: ${formatTotal(footer.values[asName] as number, isMoney)}` });
    }
  }
  const sourceLabel = labels.join(' + ');

  const reportCol = input.report?.columns.find((c) => c.name.toUpperCase() === t.reportColumn.toUpperCase());
  if (!input.report || !reportCol) return { level: 'warning', title, message: `The report has no column “${t.reportColumn}” to compare with.`, column: t.reportColumn };
  const reportMoney = reportCol.type === 'money';

  // A total column is compared with what these sources added to it (plus what the report left out); any other column is
  // compared as a whole.
  const key = reportCol.name.toUpperCase();
  const shares = input.report.sourceShares[key];
  let reportValue: number | null;
  let excludedValue = 0;
  if (shares) {
    const sum = (map: Record<string, Typed> | undefined) => ids.reduce((n, id) => n + numberOf(map?.[labelOf(input, id).toUpperCase()]), 0);
    reportValue = rupees(sum(shares), reportMoney);
    excludedValue = rupees(sum(input.report.excludedShares[key]), reportMoney) ?? 0;
  } else {
    const raw = input.report.totals
      ? input.report.totals[reportCol.name]
      : input.report.rows.reduce<number>((n, r) => n + (typeof r[reportCol.name] === 'number' ? (r[reportCol.name] as number) : 0), 0);
    reportValue = rupees(typeof raw === 'number' ? raw : null, reportMoney);
  }
  if (reportValue === null) return { level: 'warning', title, message: 'One of the two totals is blank, so they could not be compared.' };

  const diff = Math.round((reportValue + excludedValue - sourceValue) * 100) / 100;
  const fmt = (n: number) => (sourceMoney || reportMoney ? formatINR(Math.round(n * 100)) : String(n));
  const excludedText = excludedValue !== 0 ? ` + excluded ${fmt(excludedValue)}` : '';
  if (Math.abs(diff) <= t.tolerance) {
    return { level: 'info', title, message: `${sourceLabel} total ${fmt(sourceValue)} matches the report ${fmt(reportValue)}${excludedText}.`, sourceId: t.source, details };
  }
  return {
    level,
    title,
    message:
      `${sourceLabel} total is ${fmt(sourceValue)} but the report shows ${fmt(reportValue)}${excludedText}: a difference of ${fmt(diff)} (allowed ${t.tolerance}). ` +
      (level === 'error' ? 'Money is missing from the report or counted twice: find out why before using it.' : 'Check the totals.'),
    sourceId: t.source,
    details,
  };
}

const formatTotal = (v: number, money: boolean) => (money ? formatINR(v) : String(v));
const numberOf = (v: Typed | undefined): number => (typeof v === 'number' ? v : 0);
const labelOf = (input: ChecksInput, id: string): string => input.recipe.sources.find((s) => s.id === id)?.label ?? id;

export function buildChecks(input: ChecksInput): Check[] {
  const checks: Check[] = [];

  // errors from earlier steps first: these block the download
  for (const issue of input.issues.filter((i) => i.level === 'error')) {
    checks.push({ level: 'error', title: 'Problem to fix', message: issue.message, sourceId: issue.sourceId, column: issue.column });
  }

  // per source
  for (const s of input.sources) {
    if (s.errors.length > 0) continue; // already shown as errors
    const st = s.stats;
    checks.push({
      level: 'info',
      title: `${s.label}: rows`,
      message:
        `${plural(st.read, 'row')} read from ${s.fileName} (sheet “${s.sheet}”, header on row ${s.headerRow}); ` +
        `${plural(st.filtered, 'row')} left out by the row filter (this includes footer / total rows); ${plural(st.used, 'row')} used.` +
        (st.blank > 0 ? ` ${plural(st.blank, 'blank row')} skipped.` : ''),
      rows: st.used,
      sourceId: s.sourceId,
    });
    if (st.filterErrors > 0) {
      checks.push({
        level: 'warning',
        title: `${s.label}: row filter could not be evaluated`,
        message: `The row filter failed on ${plural(st.filterErrors, 'row')}, so they were left out. Fix the filter in Sources.`,
        rows: st.filterErrors,
        sourceId: s.sourceId,
        details: s.unreadable.filter((u) => u.column === '(row filter)').slice(0, MAX_DETAILS).map((u) => ({ file: s.fileName, row: u.row, text: u.message ?? 'filter error' })),
      });
    }
    for (const [column, count] of Object.entries(st.unreadableByColumn)) {
      if (column === '(row filter)') continue;
      checks.push({
        level: 'warning',
        title: `${s.label}: unreadable ${column}`,
        message: `${plural(count, 'value')} in ${column} could not be read and ${count === 1 ? 'was' : 'were'} left blank (not counted).`,
        rows: count,
        sourceId: s.sourceId,
        column,
        details: s.unreadable
          .filter((u) => u.column === column)
          .slice(0, MAX_DETAILS)
          .map((u) => ({ file: s.fileName, row: u.row, text: u.reason === 'formulaError' ? (u.message ?? 'formula error') : `“${u.raw ?? ''}” is not a valid value` })),
      });
    }
    if (st.duplicateRows > 0) {
      checks.push({
        level: 'warning',
        title: `${s.label}: repeated numbers`,
        message: `${plural(st.duplicateRows, 'row')} share a repeated ${s.duplicates.length > 0 ? 'number' : 'value'}. Check that nothing is counted twice.`,
        rows: st.duplicateRows,
        sourceId: s.sourceId,
        details: s.duplicates.map((d) => ({ file: s.fileName, row: d.rows[0], text: `${d.value} appears on rows ${d.rows.join(', ')}` })),
      });
    }
    if (s.formulaCellsWithoutValue > 0) {
      checks.push({
        level: 'warning',
        title: `${s.label}: formulas without a saved value`,
        message: `${plural(s.formulaCellsWithoutValue, 'cell')} in ${s.fileName} hold a formula but no calculated value, so they read as blank. Open the file in Excel, save it, and add it again.`,
        rows: s.formulaCellsWithoutValue,
        sourceId: s.sourceId,
      });
    }
  }

  // rows a source leaves out on purpose (for example pharmacy sold to admitted patients, billed in the IP bill)
  const leftOut = new Map<string, { rows: number; amountPaise: number }>();
  for (const s of input.sources) {
    if (s.errors.length > 0 || !s.leftOut || s.leftOut.rows === 0) continue;
    const t = leftOut.get(s.leftOut.title) ?? { rows: 0, amountPaise: 0 };
    t.rows += s.leftOut.rows;
    t.amountPaise += s.leftOut.amountPaise;
    leftOut.set(s.leftOut.title, t);
  }
  for (const [title, t] of leftOut) {
    checks.push({ level: 'info', title, message: `${plural(t.rows, 'row')}, ${formatINR(t.amountPaise)}.`, rows: t.rows, amountPaise: t.amountPaise });
  }

  if (input.ignoredFiles && input.ignoredFiles.length > 0) {
    checks.push({
      level: 'warning',
      title: 'Files not used',
      message: `${plural(input.ignoredFiles.length, 'uploaded file')} did not match any source and ${input.ignoredFiles.length === 1 ? 'was' : 'were'} not used: ${input.ignoredFiles.join(', ')}. If one of them should be in the report, say what it is on the Generate page.`,
      rows: input.ignoredFiles.length,
    });
  }

  checks.push({
    level: 'info',
    title: 'Combined data',
    message: `${plural(input.combinedRows, 'row')} from ${plural(input.sources.filter((s) => s.errors.length === 0).length, 'source')} were combined.`,
    rows: input.combinedRows,
  });

  // names
  for (const c of input.cleanup) {
    checks.push({
      level: 'info',
      title: `Names cleaned: ${c.column}`,
      message: `${plural(c.rawNames, 'spelling')} became ${plural(c.cleanNames, 'name')}; ${plural(c.mappings.reduce((n, m) => n + m.count, 0), 'cell')} changed.` + (c.blankRows > 0 ? ` ${plural(c.blankRows, 'row')} have no ${c.column}.` : ''),
      rows: c.mappings.reduce((n, m) => n + m.count, 0),
      column: c.column,
      details: c.mappings.slice(0, MAX_DETAILS).map((m) => ({ text: `“${m.raw}” → “${m.clean}” (${plural(m.count, 'row')})` })),
    });
    if (c.unmatchedByAlias.length > 0) {
      checks.push({
        level: 'info',
        title: `Names left as they are: ${c.column}`,
        message: `${plural(c.unmatchedByAlias.length, 'name')} in ${c.column} are not covered by an alias. If two of them are the same person, merge them in Prepare.`,
        rows: c.unmatchedByAlias.length,
        column: c.column,
        details: c.unmatchedByAlias.slice(0, MAX_DETAILS).map((u) => ({ text: `${u.name} (${plural(u.count, 'row')})` })),
      });
    }
  }

  // lookups
  for (const l of input.lookups) {
    const { Matched, Fallback, Ambiguous, Unattributed } = l.byStatus;
    const amount = (s: keyof typeof l.byStatus) => (l.amountColumn ? ` (${formatINR(l.amountByStatus[s])})` : '');
    checks.push({
      level: Unattributed > 0 || Fallback > 0 ? 'warning' : 'info',
      title: `Lookup: ${l.label}`,
      message:
        `${plural(l.considered, 'row')} looked up${l.skipped > 0 ? ` (${plural(l.skipped, 'row')} skipped by the “only when” rule)` : ''}: ` +
        `${Matched} matched${amount('Matched')}, ${Fallback} used the nearest record${amount('Fallback')}, ` +
        `${Ambiguous} ambiguous${amount('Ambiguous')}, ${Unattributed} not found${amount('Unattributed')}.` +
        (l.blankKeyRows > 0 ? ` ${plural(l.blankKeyRows, 'row')} had no key.` : ''),
      rows: l.considered,
      amountPaise: l.amountColumn ? l.amountByStatus.Unattributed : undefined,
      details: l.notFoundKeys.map((k) => ({ text: `not found: ${k}` })),
    });
    if (Ambiguous > 0) {
      checks.push({
        level: 'warning',
        title: `Lookup: ${l.label}: ambiguous`,
        message:
          `${plural(Ambiguous, 'row')}${l.amountColumn ? ` (${formatINR(l.amountByStatus.Ambiguous)})` : ''} matched a record day that has more than one different value, ` +
          'so the right one cannot be known for certain. The tie-break rule chose the value written. Check these and, if needed, change the tie-break in Prepare.',
        rows: Ambiguous,
        amountPaise: l.amountColumn ? l.amountByStatus.Ambiguous : undefined,
        details: l.ambiguousExamples.map((a) => ({ text: `${a.key}${a.day ? ` on ${a.day}` : ''}: ${a.values.join(' / ')} → written: ${a.written}` })),
      });
    }
  }

  // report
  if (input.report) {
    checks.push({
      level: 'info',
      title: 'Report',
      message:
        `${plural(input.report.rows.length, 'row')} in the report, from ${plural(input.report.inputRows, 'combined row')}. ` +
        (input.report.excluded ? `${plural(input.report.excluded.rows, 'combined row')} ${input.report.excluded.rows === 1 ? 'is' : 'are'} excluded on purpose (see below); every other one is counted.` : 'No combined row is left out.'),
      rows: input.report.rows.length,
    });
    const ex = input.report.excluded;
    if (ex) {
      const amountText = (amounts: Record<string, number>) =>
        input.report?.columns
          .filter((c) => c.kind === 'aggregate' && amounts[c.name] !== undefined)
          .map((c) => `${ex.amountLabels[c.name] ?? c.name} ${c.type === 'money' ? formatINR(amounts[c.name] as number) : String(amounts[c.name])}`)
          .join(', ') ?? '';
      const line = (rows: number, amounts: Record<string, number>) => [plural(rows, 'line'), amountText(amounts)].filter((x) => x !== '').join(', ');
      checks.push({
        level: 'info',
        title: `Excluded from report: ${ex.label ?? 'rows left out by the report rule'}`,
        message: `${line(ex.rows, ex.amounts)}. They are not in any report row or in the totals; the tie-outs add them back.`,
        rows: ex.rows,
        details: ex.groups.length > 1 || (ex.groups[0] && ex.groups[0].label !== 'other') ? ex.groups.map((g) => ({ text: `${g.label}: ${line(g.rows, g.amounts)}` })) : undefined,
      });
    }
    const hidden = input.report.hidden;
    if (hidden.length > 0) {
      const listed = hidden.slice(0, MAX_HIDDEN_LISTED);
      const combined = hidden.reduce((n, h) => n + h.combinedRows, 0);
      checks.push({
        level: 'info',
        title: 'Report rows hidden (all aggregate columns 0)',
        message:
          `${plural(hidden.length, 'row')} of the report ${hidden.length === 1 ? 'was' : 'were'} left out because every aggregate column is 0 (from ${plural(combined, 'combined row')}). ` +
          'The report totals still include them. Switch “Hide rows where all aggregate columns are 0” off in Report to show them.' +
          (hidden.length > listed.length ? ` The first ${listed.length.toLocaleString('en-IN')} are listed.` : ''),
        rows: hidden.length,
        details: listed.map((h) => ({ text: `${h.label} (${plural(h.combinedRows, 'combined row')})` })),
        detailLimit: MAX_HIDDEN_LISTED,
      });
    }
  }
  for (const issue of input.issues.filter((i) => i.level !== 'error')) {
    checks.push({ level: issue.level, title: issue.level === 'warning' ? 'Please check' : 'Note', message: issue.message, sourceId: issue.sourceId, column: issue.column });
  }
  for (const t of input.recipe.checks.tieOuts) checks.push(tieOutCheck(t, input));
  for (const n of input.templateNotes ?? []) checks.push({ level: n.level, title: 'Template', message: n.message });

  const order: Record<IssueLevel, number> = { error: 0, warning: 1, info: 2 };
  return checks.map((c, i) => ({ c, i })).sort((a, b) => order[a.c.level] - order[b.c.level] || a.i - b.i).map((x) => x.c);
}

export const hasErrors = (checks: readonly Check[]): boolean => checks.some((c) => c.level === 'error');
