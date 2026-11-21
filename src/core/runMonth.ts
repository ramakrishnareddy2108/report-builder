// Build one month's run from the source files that were read: apply the rules,
// attribute pharmacy to doctors, and collect everything the Checks need.
// Pure: the worker reads the files, this turns the rows into facts.

import type { MappedRow, MappedSheet, MappingProblem, SkipReason } from '@/excel/mapSource';
import { ConsultationIndex } from './attribution';
import { DoctorMatcher, GroupResolver } from './doctors';
import { sumPaise } from './money';
import { applyRules, requiredFields, type SourceRows } from './rules';
import type { DoctorsFile, RulesFile, SourcesFile } from './schemas';
import {
  addCounted,
  emptyCounted,
  type Counted,
  type RowExample,
  type RunDiagnostics,
  type SourceDiag,
} from './runTypes';
import {
  ATTRIBUTION_SOURCE_ID,
  FIELD_KEYS,
  FIELD_KINDS,
  SOURCE_IDS,
  type FactRow,
  type FieldKey,
  type FileFingerprint,
  type SourceId,
} from './types';

/** A source file after reading: used, or flagged because it does not fit its mapping. */
export type ReadSource =
  | { status: 'read'; sourceId: SourceId; fileName: string; sizeBytes: number; sha256: string; mapped: MappedSheet }
  | { status: 'flagged'; sourceId: SourceId; fileName: string; sizeBytes: number; sha256: string; problems: MappingProblem[] };

export type RunSettings = { sources: SourcesFile; doctors: DoctorsFile; rules: RulesFile };

export type BuildRunInput = {
  /** 'YYYY-MM'. */
  month: string;
  settings: RunSettings;
  /** One entry per source that had a file. A needed source with no entry is reported as missing. */
  read: readonly ReadSource[];
};

export type RunOutput = { month: string; facts: FactRow[]; diagnostics: RunDiagnostics };

const SKIP_REASONS: readonly SkipReason[] = ['blank', 'noReference', 'filtered', 'filterError'];

const refOf = (row: { values: MappedRow['values'] }): string | null => {
  const r = row.values.ref;
  return typeof r === 'string' ? r : null;
};

function moneyFields(fields: Partial<Record<FieldKey, unknown>>): FieldKey[] {
  return FIELD_KEYS.filter((k) => fields[k] !== undefined && FIELD_KINDS[k] === 'money');
}

function sumField(rows: readonly { values: MappedRow['values'] }[], key: FieldKey): number {
  return sumPaise(rows.map((r) => (typeof r.values[key] === 'number' ? (r.values[key] as number) : 0)));
}

const hasNumber = (rows: readonly { values: MappedRow['values'] }[], key: FieldKey): boolean =>
  rows.some((r) => typeof r.values[key] === 'number');

/** Diagnostics for a source that was read. */
function readDiag(
  base: { sourceId: SourceId; needed: boolean; fileName: string },
  mapped: MappedSheet,
  fields: Partial<Record<FieldKey, unknown>>,
  refUnique: boolean,
  usedFields: ReadonlySet<FieldKey>,
): SourceDiag {
  const { fileName } = base;
  const skipped = Object.fromEntries(SKIP_REASONS.map((r) => [r, emptyCounted()])) as Record<SkipReason, Counted>;
  const footer: { values: MappedRow['values'] }[] = [];
  for (const s of mapped.skipped) {
    const example: RowExample = { sourceFile: fileName, sourceRow: s.row, ref: s.values ? refOf({ values: s.values }) : null, ...(s.message ? { detail: s.message } : {}) };
    addCounted(skipped[s.reason], example);
    if (s.reason === 'noReference' && s.values) footer.push({ values: s.values });
  }

  const money = moneyFields(fields);
  const fieldTotals: SourceDiag['fieldTotals'] = {};
  const footerTotals: SourceDiag['footerTotals'] = {};
  for (const key of money) {
    fieldTotals[key] = sumField(mapped.rows, key);
    if (hasNumber(footer, key)) footerTotals[key] = sumField(footer, key);
  }

  const unreadableUnused = emptyCounted();
  for (const row of mapped.rows) {
    for (const issue of row.issues) {
      if (issue.field === 'rowFilter' || usedFields.has(issue.field)) continue; // counted by the rule terms
      addCounted(unreadableUnused, { sourceFile: fileName, sourceRow: row.row, ref: refOf(row), detail: `${issue.field}: ${issue.message}` });
    }
  }

  const duplicateRefs: SourceDiag['duplicateRefs'] = { rows: 0, examples: [] };
  if (refUnique) {
    const seen = new Map<string, number[]>();
    for (const row of mapped.rows) {
      const ref = refOf(row);
      if (ref !== null) seen.set(ref, [...(seen.get(ref) ?? []), row.row]);
    }
    for (const [ref, rows] of seen) {
      if (rows.length < 2) continue;
      duplicateRefs.rows += rows.length;
      if (duplicateRefs.examples.length < 5) duplicateRefs.examples.push({ ref, rows });
    }
  }

  return {
    ...base,
    status: 'read',
    problems: [],
    rowsRead: mapped.rowsRead,
    rowsMapped: mapped.rows.length,
    skipped,
    fieldTotals,
    footerTotals,
    footerRows: footer.length,
    duplicateRefs,
    unreadableUnused,
  };
}

function notReadDiag(sourceId: SourceId, needed: boolean, status: 'missing' | 'flagged', fileName: string | null, problems: MappingProblem[]): SourceDiag {
  return {
    sourceId,
    needed,
    status,
    fileName,
    problems,
    rowsRead: 0,
    rowsMapped: 0,
    skipped: Object.fromEntries(SKIP_REASONS.map((r) => [r, emptyCounted()])) as Record<SkipReason, Counted>,
    fieldTotals: {},
    footerTotals: {},
    footerRows: 0,
    duplicateRefs: { rows: 0, examples: [] },
    unreadableUnused: emptyCounted(),
  };
}

/** Patients (UMR + date) that appear in both OP Billing and OP Consultations. */
function opOverlap(billing: MappedSheet | undefined, consultations: MappedSheet | undefined): RunDiagnostics['opOverlap'] {
  if (!billing || !consultations) return { pairs: 0, examples: [] };
  const key = (r: MappedRow) => (typeof r.values.umrno === 'string' && typeof r.values.txnDate === 'string' ? `${r.values.umrno} · ${r.values.txnDate}` : null);
  const inBilling = new Set(billing.rows.map(key).filter((k): k is string => k !== null));
  const both = new Set<string>();
  for (const r of consultations.rows) {
    const k = key(r);
    if (k !== null && inBilling.has(k)) both.add(k);
  }
  return { pairs: both.size, examples: [...both].slice(0, 5) };
}

/** Files with identical bytes (same SHA-256). Empty hashes (files that were not read) never match. */
export function findDuplicateFiles(files: readonly { sourceId: SourceId; fileName: string; sha256: string }[]): RunDiagnostics['duplicateFiles'] {
  const byHash = new Map<string, typeof files[number][]>();
  for (const f of files) if (f.sha256 !== '') byHash.set(f.sha256, [...(byHash.get(f.sha256) ?? []), f]);
  return [...byHash.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([sha256, list]) => ({ sha256, fileNames: list.map((f) => f.fileName), sourceIds: list.map((f) => f.sourceId) }));
}

export function buildRun({ month, settings, read }: BuildRunInput): RunOutput {
  const readBySource = new Map(read.map((r) => [r.sourceId, r]));
  const sources = new Map<SourceId, SourceRows>();
  const diag: SourceDiag[] = [];

  for (const sourceId of SOURCE_IDS) {
    const needed = requiredFields(settings.rules, sourceId).size > 0;
    const entry = readBySource.get(sourceId);
    if (!entry) {
      diag.push(notReadDiag(sourceId, needed, 'missing', null, []));
    } else if (entry.status === 'flagged') {
      diag.push(notReadDiag(sourceId, needed, 'flagged', entry.fileName, entry.problems));
    } else {
      sources.set(sourceId, { sourceId, fileName: entry.fileName, mapped: entry.mapped });
      const mapping = settings.sources.sources.find((m) => m.sourceId === sourceId);
      diag.push(readDiag({ sourceId, needed, fileName: entry.fileName }, entry.mapped, mapping?.fields ?? {}, mapping?.refUnique ?? false, requiredFields(settings.rules, sourceId)));
    }
  }

  const consultationRows = sources.get(ATTRIBUTION_SOURCE_ID)?.mapped.rows;
  const out = applyRules({
    month,
    rules: settings.rules,
    sources,
    doctors: new DoctorMatcher(settings.doctors.doctors),
    departments: new GroupResolver(settings.doctors.departments),
    sponsors: new GroupResolver(settings.doctors.sponsors),
    consultations: consultationRows ? new ConsultationIndex(consultationRows) : null,
  });

  const fingerprints: FileFingerprint[] = read.map(({ sourceId, fileName, sizeBytes, sha256 }) => ({ sourceId, fileName, sizeBytes, sha256 }));

  return {
    month,
    facts: out.facts,
    diagnostics: {
      month,
      sources: diag,
      terms: out.terms,
      unmatchedDoctors: out.unmatchedDoctors,
      duplicateFiles: findDuplicateFiles(fingerprints),
      opOverlap: opOverlap(sources.get('opBilling')?.mapped, sources.get(ATTRIBUTION_SOURCE_ID)?.mapped),
      ruleProblems: out.ruleProblems,
      fingerprints,
    },
  };
}
