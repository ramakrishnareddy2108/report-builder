// Shared types of the engine. The engine is pure functions: no React, no browser APIs.

import type { ColumnType } from '@/recipe/schema';

/**
 * A typed cell of the combined table.
 *   text → string · number → number · money → integer PAISE · date → ISO "YYYY-MM-DD" · blank → null
 */
export type Typed = string | number | null;

export type IssueLevel = 'error' | 'warning' | 'info';

/** A problem or note, in plain language. An `error` blocks the download; a `warning` is shown. */
export type Issue = {
  level: IssueLevel;
  message: string;
  /** Source id, when the issue belongs to one source. */
  sourceId?: string;
  /** The column involved (used for the "Fix mapping" shortcut). */
  column?: string;
};

export type ColumnDef = { name: string; type: ColumnType };

/** One row of one source, after filtering, renaming and conversion. */
export type SourceRow = {
  /** Excel row number in the file. */
  row: number;
  values: Record<string, Typed>;
};

/** A value that was there but could not be read as its type (counted and listed in the Checks). */
export type UnreadableValue = { row: number; column: string; raw: string | null; reason: 'unreadable' | 'formulaError'; message?: string };

export type SourceStats = {
  /** Data rows below the header that hold something. */
  read: number;
  /** Rows left out by the row filter (this includes footer / total rows). */
  filtered: number;
  /** Rows that went on into the combined table. */
  used: number;
  /** Completely blank rows below the header (counted, not data). */
  blank: number;
  /** Rows the row filter could not be evaluated on (they are left out, and counted here too). */
  filterErrors: number;
  /** Per renamed or calculated column: values that were not blank but could not be read. */
  unreadableByColumn: Record<string, number>;
  /** Used rows whose value in `uniqueColumn` appears more than once (0 when no check is set). */
  duplicateRows: number;
};

export type ReadSourceResult = {
  sourceId: string;
  label: string;
  sheet: string;
  /** 1-based Excel row of the header. */
  headerRow: number;
  columns: ColumnDef[];
  rows: SourceRow[];
  stats: SourceStats;
  /** The first unreadable values (a limited list; the counts in `stats` are complete). */
  unreadable: UnreadableValue[];
  /**
   * Rows at the very end that the row filter left out: normally the grand-total row of an export.
   * Their values are kept for the tie-out check.
   */
  footerRows: SourceRow[];
  /** Examples of repeated IDs (value → Excel rows), when `uniqueColumn` is set. */
  duplicates: { value: string; rows: number[] }[];
  /** Blocking errors (a missing column, a bad formula). When there are any, `rows` is empty. */
  errors: Issue[];
};

export type CombinedRow = Record<string, Typed>;

export type CombinedTable = {
  /** Every column of the table, in order: source columns, then Source, _file, _row and the parameters. */
  columns: ColumnDef[];
  rows: CombinedRow[];
};

/** Recipe parameter values as typed in the Generate page. */
export type ParamValues = Readonly<Record<string, string>>;

export const SOURCE_COLUMN = 'Source';
export const FILE_COLUMN = '_file';
export const ROW_COLUMN = '_row';
