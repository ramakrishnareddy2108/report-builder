// Apply a SourceMapping to a sheet: resolve each field to a column, fixed value
// or formula, then read rows as typed values.
//
// Nothing is dropped silently: every row that is not used comes back in
// `skipped` with a reason, and every unreadable amount or date is recorded in
// the row's `issues`.

import { parseMoney } from '@/core/money';
import { toIsoDate } from '@/core/dates';
import { FIELD_KINDS, type FieldKey, type FieldMapping, type SourceId, type SourceMapping } from '@/core/types';
import { ColumnIndex, compileFormula, describeFormulaError, toBool, type CompiledFormula, type Value } from '@/formula';
import { columnIndex, columnLetter, findHeaderColumn } from './detectHeader';
import type { CellValue, Row } from './readWorkbook';

// ---------------------------------------------------------------------------
// Resolving a mapping against a header row
// ---------------------------------------------------------------------------

export type SheetHeader = {
  /** Header text as it appears ('' for blanks); used for [Column] lookups by name. */
  rawHeaders: readonly string[];
  /** Unique names (blank → "Column F", repeat → "NAME (2)"); formulas can use these. */
  headers: readonly string[];
};

export type ResolvedField =
  | { type: 'column'; index: number }
  | { type: 'fixed'; value: string | number }
  | { type: 'formula'; formula: CompiledFormula };

export type MappingProblem = {
  field: FieldKey | 'rowFilter';
  /** Plain-language explanation. */
  message: string;
  /** Column names a formula or mapping needs but the file does not have. */
  missingColumns: string[];
};

export type ResolvedMapping = {
  sourceId: SourceId;
  headerRow: number;
  fields: Partial<Record<FieldKey, ResolvedField>>;
  rowFilter: CompiledFormula | null;
  columns: ColumnIndex;
  /** Empty means the file fits the mapping. */
  problems: MappingProblem[];
};

/**
 * Headers of columns that hold patient details. Names, phone numbers and addresses are never read
 * into the app, so a mapping may not point at them (a doctor, a bill number and so on are fine).
 */
const PATIENT_COLUMN = /patient|mobile|phone|address|contact|guardian|relative|aadha+r/i;

export function isPatientColumn(header: string): boolean {
  return PATIENT_COLUMN.test(header);
}

const patientProblem = (column: string): string =>
  `The column “${column}” holds patient details. Patient names, phone numbers and addresses are never used or stored; choose another column.`

/** Column position for a column mapping, or null when the file has no such column. */
function locateColumn(
  m: Extract<SourceMapping['fields'][FieldKey], { type: 'column' }>,
  header: SheetHeader,
): number | null {
  if (m.by === 'letter') {
    const i = columnIndex(m.value);
    return i !== null && i < header.rawHeaders.length ? i : null;
  }
  return findHeaderColumn(header.rawHeaders, m.value, m.occurrence ?? 1);
}

function describeColumn(m: { value: string; by?: 'header' | 'letter'; occurrence?: number }): string {
  if (m.by === 'letter') return `column ${m.value.toUpperCase()}`;
  return m.occurrence && m.occurrence > 1 ? `“${m.value}” (no. ${m.occurrence})` : `“${m.value}”`;
}

/**
 * The column mapping that points at column `index`: by header text (with the
 * occurrence number for a repeated header), or by letter when the header is blank.
 */
export function columnMappingAt(rawHeaders: readonly string[], index: number): FieldMapping {
  const name = rawHeaders[index] ?? '';
  if (name === '') return { type: 'column', value: columnLetter(index), by: 'letter' };
  const key = name.toUpperCase();
  const occurrence = rawHeaders.slice(0, index + 1).filter((h) => h.toUpperCase() === key).length;
  return occurrence > 1 ? { type: 'column', value: name, occurrence } : { type: 'column', value: name };
}

/** Label for a column in a picker: "AH · ORGNAME". */
export function columnLabel(rawHeaders: readonly string[], index: number): string {
  return `${columnLetter(index)} · ${rawHeaders[index] || '(no header)'}`;
}

/** Formula columns the file does not have. */
function missingFormulaColumns(formula: CompiledFormula, columns: ColumnIndex): string[] {
  return formula.columns.filter((c) => columns.find(c) === null);
}

/**
 * @param required fields the measure rules need from this source; a required
 *   field that is not mapped is a problem too.
 */
export function resolveMapping(
  mapping: SourceMapping,
  header: SheetHeader,
  required: ReadonlySet<FieldKey> = new Set(),
): ResolvedMapping {
  const columns = new ColumnIndex(header.headers);
  const fields: ResolvedMapping['fields'] = {};
  const problems: MappingProblem[] = [];

  const compile = (text: string, field: FieldKey | 'rowFilter', what: string): CompiledFormula | null => {
    try {
      const formula = compileFormula(text);
      const patient = formula.columns.map((c) => header.headers[columns.find(c) ?? -1] ?? '').find(isPatientColumn);
      if (patient) {
        problems.push({ field, message: patientProblem(patient), missingColumns: [] });
        return null;
      }
      const missing = missingFormulaColumns(formula, columns);
      if (missing.length > 0) {
        problems.push({
          field,
          message: `${what} uses ${missing.map((c) => `[${c}]`).join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not in this file.`,
          missingColumns: missing,
        });
        return null;
      }
      return formula;
    } catch (err) {
      problems.push({ field, message: `${what} is not a valid formula: ${describeFormulaError(err)}`, missingColumns: [] });
      return null;
    }
  };

  for (const [key, m] of Object.entries(mapping.fields) as [FieldKey, NonNullable<SourceMapping['fields'][FieldKey]>][]) {
    if (m.type === 'column') {
      const index = locateColumn(m, header);
      if (index !== null && isPatientColumn(header.rawHeaders[index] ?? '')) {
        problems.push({ field: key, message: patientProblem(header.rawHeaders[index] as string), missingColumns: [] });
      } else if (index === null) {
        problems.push({
          field: key,
          message: `${describeColumn(m)} was not found in this file (needed for ${key}).`,
          missingColumns: [m.value],
        });
      } else {
        fields[key] = { type: 'column', index };
      }
    } else if (m.type === 'fixed') {
      fields[key] = { type: 'fixed', value: m.value };
    } else if (m.type === 'formula') {
      const formula = compile(m.value, key, `The formula for ${key}`);
      if (formula) fields[key] = { type: 'formula', formula };
    }
  }

  const rowFilter = mapping.rowFilter ? compile(mapping.rowFilter, 'rowFilter', 'The row filter') : null;

  for (const key of required) {
    const m = mapping.fields[key];
    if (!m || m.type === 'none') {
      problems.push({ field: key, message: `The rules need “${key}”, but it is not mapped.`, missingColumns: [] });
    }
  }

  return { sourceId: mapping.sourceId, headerRow: mapping.headerRow, fields, rowFilter, columns, problems };
}

// ---------------------------------------------------------------------------
// Reading rows
// ---------------------------------------------------------------------------

/** id/text → string, date → ISO date, money → integer paise. null = blank. */
export type MappedValue = string | number | null;

export type RowIssue = {
  field: FieldKey | 'rowFilter';
  kind: 'badAmount' | 'badDate' | 'formulaError';
  message: string;
  /** The cell as read, shortened (never a patient field: only mapped fields are read). */
  raw: string | null;
};

export type MappedRow = {
  /** Excel row number. */
  row: number;
  values: Partial<Record<FieldKey, MappedValue>>;
  issues: RowIssue[];
};

export type SkipReason =
  | 'blank' //        nothing in the row
  | 'noReference' //  no bill/admission number: a grand-total or note row
  | 'filtered' //     the mapping's row filter said no
  | 'filterError'; // the row filter could not be evaluated

export const SKIP_REASON_LABELS: Readonly<Record<SkipReason, string>> = {
  blank: 'Blank row',
  noReference: 'No bill / admission number (grand-total or note row)',
  filtered: 'Excluded by the row filter',
  filterError: 'Row filter could not be evaluated',
};

export type SkippedRow = {
  row: number;
  reason: SkipReason;
  /** Mapped values of a no-reference row, kept so a grand total can be compared with the data. */
  values?: MappedRow['values'];
  message?: string;
};

export type MappedSheet = {
  /** Data rows below the header that were looked at. */
  rowsRead: number;
  rows: MappedRow[];
  skipped: SkippedRow[];
};

const MAX_RAW = 40;

function describeRaw(v: Value): string | null {
  if (v === null) return null;
  const s = v instanceof Date ? (toIsoDate(v) ?? String(v)) : String(v);
  return s.length > MAX_RAW ? `${s.slice(0, MAX_RAW)}…` : s;
}

function isBlankCell(v: CellValue | undefined): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** Text for id/text fields: trimmed; whole numbers lose a trailing ".0". */
function toTextValue(v: Value): string | null {
  if (v === null) return null;
  if (v instanceof Date) return toIsoDate(v);
  const s = (typeof v === 'number' ? String(Number(v.toPrecision(15))) : String(v)).trim();
  return s === '' ? null : s;
}

function convert(key: FieldKey, v: Value, issues: RowIssue[]): MappedValue {
  const kind = FIELD_KINDS[key];
  if (kind === 'money') {
    const r = parseMoney(v);
    if (r.ok) return r.paise;
    if (r.reason === 'invalid') {
      issues.push({ field: key, kind: 'badAmount', message: `“${describeRaw(v)}” is not a readable amount`, raw: describeRaw(v) });
    }
    return null;
  }
  if (kind === 'date') {
    if (v === null || (typeof v === 'string' && v.trim() === '')) return null;
    const iso = toIsoDate(v);
    if (iso === null) {
      issues.push({ field: key, kind: 'badDate', message: `“${describeRaw(v)}” is not a readable date`, raw: describeRaw(v) });
    }
    return iso;
  }
  return toTextValue(v);
}

function readField(f: ResolvedField, key: FieldKey, row: Row, columns: ColumnIndex, issues: RowIssue[]): MappedValue {
  switch (f.type) {
    case 'column':
      return convert(key, row[f.index] ?? null, issues);
    case 'fixed':
      return convert(key, f.value, issues);
    case 'formula':
      try {
        return convert(key, f.formula.evaluate(columns.forRow(row)), issues);
      } catch (err) {
        issues.push({ field: key, kind: 'formulaError', message: describeFormulaError(err), raw: null });
        return null;
      }
  }
}

export type ReadMappedOptions = {
  /** Stop after this many data rows (previews). */
  maxRows?: number;
};

/**
 * Read the data rows (everything below the header row) of a sheet as typed values.
 * `rows[0]` is Excel row 1, as returned by readSheetRows.
 */
export function readMappedRows(resolved: ResolvedMapping, rows: readonly Row[], opts: ReadMappedOptions = {}): MappedSheet {
  const out: MappedSheet = { rowsRead: 0, rows: [], skipped: [] };
  const entries = Object.entries(resolved.fields) as [FieldKey, ResolvedField][];
  const refField = resolved.fields.ref;

  for (let r = resolved.headerRow; r < rows.length; r++) {
    if (opts.maxRows !== undefined && out.rowsRead >= opts.maxRows) break;
    const row = rows[r] as Row;
    const excelRow = r + 1;
    out.rowsRead++;

    if (row.every(isBlankCell)) {
      out.skipped.push({ row: excelRow, reason: 'blank' });
      continue;
    }

    const issues: RowIssue[] = [];
    const values: MappedRow['values'] = {};
    for (const [key, field] of entries) values[key] = readField(field, key, row, resolved.columns, issues);

    // A row without an ID is a grand-total or note row, not data.
    if (refField && values.ref === null) {
      out.skipped.push({ row: excelRow, reason: 'noReference', values });
      continue;
    }

    if (resolved.rowFilter) {
      try {
        if (!toBool(resolved.rowFilter.evaluate(resolved.columns.forRow(row)))) {
          out.skipped.push({ row: excelRow, reason: 'filtered' });
          continue;
        }
      } catch (err) {
        out.skipped.push({ row: excelRow, reason: 'filterError', message: describeFormulaError(err) });
        continue;
      }
    }

    out.rows.push({ row: excelRow, values, issues });
  }
  return out;
}
