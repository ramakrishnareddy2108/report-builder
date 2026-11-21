// What a month run reports about itself, beyond the fact rows.
//
// Everything the Checks need is here: every row that was not used, every
// unmatched name and every unreadable amount is counted, with a few example
// rows. Nothing in here holds patient names, phones or addresses.

import type { MappingProblem, SkipReason } from '@/excel/mapSource';
import type { FieldKey, FileFingerprint, MeasureCode, SourceId } from './types';

/** A row to point the user at (file, Excel row and bill / admission no.). */
export type RowExample = {
  sourceFile: string;
  sourceRow: number;
  ref: string | null;
  detail?: string;
};

/** A count with a few example rows. */
export type Counted = { count: number; examples: RowExample[] };

export const MAX_EXAMPLES = 5;

export const emptyCounted = (): Counted => ({ count: 0, examples: [] });

export function addCounted(c: Counted, example: RowExample): void {
  c.count++;
  if (c.examples.length < MAX_EXAMPLES) c.examples.push(example);
}

/** What happened to the rows offered to one rule term (one source's contribution to a measure). */
export type TermStat = {
  sourceId: SourceId;
  measure: MeasureCode;
  /** Position of the term in the measure's rule. */
  termIndex: number;
  sign: 1 | -1;
  /** Rows of the source offered to the term. */
  rowsConsidered: number;
  /** Rows that became fact rows. */
  facts: number;
  /** Sum of the fact amounts, signed (a count measure counts 1 per row). */
  sumPaise: number;
  /** Rows left out because the term's filter said no. */
  filtered: number;
  /** OP-pharmacy rows of in-patients (admission no. filled), counted apart. */
  ipViaOp: Counted & { amountPaise: number };
  /** Rows left out because the term's filter could not be evaluated. */
  filterError: Counted;
  /** Rows left out because an amount the term needs could not be read. */
  badAmount: Counted;
  /** Rows used but dated outside the month. */
  outsideMonth: Counted;
  /** Rows used but with no readable date. */
  noDate: Counted;
};

export type SourceDiag = {
  sourceId: SourceId;
  /** True when an active measure rule (or pharmacy attribution) uses this source. */
  needed: boolean;
  /** read: used; missing: no file; flagged: the file does not fit its mapping. */
  status: 'read' | 'missing' | 'flagged';
  fileName: string | null;
  problems: MappingProblem[];
  /** Data rows below the header. */
  rowsRead: number;
  /** Rows that were not blank, not a total row and passed the mapping's row filter. */
  rowsMapped: number;
  skipped: Record<SkipReason, Counted>;
  /** Sum of each mapped amount column over the mapped rows (integer paise). */
  fieldTotals: Partial<Record<FieldKey, number>>;
  /** Sum of the same columns on the file's own grand-total row(s). */
  footerTotals: Partial<Record<FieldKey, number>>;
  footerRows: number;
  /** Bill / admission numbers that appear more than once (only when the mapping says they are unique). */
  duplicateRefs: { rows: number; examples: { ref: string; rows: number[] }[] };
  /** Amount or date cells that could not be read, in any mapped column. */
  unreadableCells: Counted;
};

export type UnmatchedDoctor = {
  raw: string;
  rows: number;
  sources: SourceId[];
  /** Two doctors in the list claim this spelling. */
  ambiguous: boolean;
};

export type RunDiagnostics = {
  month: string;
  sources: SourceDiag[];
  terms: TermStat[];
  unmatchedDoctors: UnmatchedDoctor[];
  /** The same file used for two sources. */
  duplicateFiles: { sha256: string; fileNames: string[]; sourceIds: SourceId[] }[];
  /** Patients (UMR + date) found in both OP Billing and OP Consultations. */
  opOverlap: { pairs: number; examples: string[] };
  /** Rule formulas that could not be read or refer to unknown fields. */
  ruleProblems: string[];
  fingerprints: FileFingerprint[];
};
