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
import type { Issue, IssueLevel, SourceSummary } from './types';

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
  /** Notes from filling the template (including the formula cross-check). */
  templateNotes?: readonly { level: IssueLevel; message: string }[];
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;
const MAX_DETAILS = 25;

/** The value of a tie-out: rupees as a plain number. */
function rupees(v: number | null, money: boolean): number | null {
  return v === null ? null : money ? v / 100 : v;
}

function tieOutCheck(t: TieOut, input: ChecksInput): Check {
  const title = `Tie-out: ${t.label}`;
  const def = input.recipe.sources.find((s) => s.id === t.source);
  const summary = input.sources.find((s) => s.sourceId === t.source);
  if (!def) return { level: 'warning', title, message: `The source “${t.source}” of this tie-out is not in the recipe.` };
  if (!summary) return { level: 'warning', title, message: `${def.label} has no file this time, so its total cannot be compared.`, sourceId: t.source };

  const columnDef =
    def.columns.find((c) => c.as.toUpperCase() === t.column.toUpperCase() || c.from.toUpperCase() === t.column.toUpperCase()) ??
    def.calculated.find((c) => c.as.toUpperCase() === t.column.toUpperCase());
  const asName = columnDef ? ('as' in columnDef ? columnDef.as : t.column) : t.column;
  const footer = [...summary.footerRows].reverse().find((r) => typeof r.values[asName] === 'number');
  if (!footer) {
    return { level: 'warning', title, message: `No total row was found at the end of ${def.label}, so ${asName} could not be compared with the report.`, sourceId: t.source };
  }
  const sourceMoney = columnDef?.type === 'money';
  const sourceValue = rupees(footer.values[asName] as number, sourceMoney);

  const reportCol = input.report?.columns.find((c) => c.name.toUpperCase() === t.reportColumn.toUpperCase());
  if (!input.report || !reportCol) return { level: 'warning', title, message: `The report has no column “${t.reportColumn}” to compare with.`, column: t.reportColumn };
  const raw = input.report.totals
    ? input.report.totals[reportCol.name]
    : input.report.rows.reduce<number>((sum, r) => sum + (typeof r[reportCol.name] === 'number' ? (r[reportCol.name] as number) : 0), 0);
  const reportValue = rupees(typeof raw === 'number' ? raw : null, reportCol.type === 'money');
  if (sourceValue === null || reportValue === null) return { level: 'warning', title, message: 'One of the two totals is blank, so they could not be compared.' };

  const diff = Math.round((reportValue - sourceValue) * 100) / 100;
  const fmt = (n: number) => (sourceMoney || reportCol.type === 'money' ? formatINR(Math.round(n * 100)) : String(n));
  if (Math.abs(diff) <= t.tolerance) {
    return { level: 'info', title, message: `${def.label} total ${fmt(sourceValue)} matches the report ${fmt(reportValue)}.`, sourceId: t.source };
  }
  return {
    level: 'warning',
    title,
    message: `${def.label} total (row ${footer.row} of ${summary.fileName}) is ${fmt(sourceValue)} but the report shows ${fmt(reportValue)}: a difference of ${fmt(diff)} (allowed ${t.tolerance}).`,
    sourceId: t.source,
    details: [{ file: summary.fileName, row: footer.row, text: `${asName} total in the file: ${fmt(sourceValue)}` }],
  };
}

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
    const { Matched, Fallback, Unattributed } = l.byStatus;
    const amount = (s: keyof typeof l.byStatus) => (l.amountColumn ? ` (${formatINR(l.amountByStatus[s])})` : '');
    checks.push({
      level: Unattributed > 0 || Fallback > 0 ? 'warning' : 'info',
      title: `Lookup: ${l.label}`,
      message:
        `${plural(l.considered, 'row')} looked up${l.skipped > 0 ? ` (${plural(l.skipped, 'row')} skipped by the “only when” rule)` : ''}: ` +
        `${Matched} matched${amount('Matched')}, ${Fallback} used the nearest record${amount('Fallback')}, ${Unattributed} not found${amount('Unattributed')}.` +
        (l.blankKeyRows > 0 ? ` ${plural(l.blankKeyRows, 'row')} had no key.` : ''),
      rows: l.considered,
      amountPaise: l.amountColumn ? l.amountByStatus.Unattributed : undefined,
      details: l.notFoundKeys.map((k) => ({ text: `not found: ${k}` })),
    });
  }

  // report
  if (input.report) {
    checks.push({
      level: 'info',
      title: 'Report',
      message: `${plural(input.report.rows.length, 'row')} in the report, from ${plural(input.report.inputRows, 'combined row')}. No combined row is left out.`,
      rows: input.report.rows.length,
    });
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
