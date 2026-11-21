// Pipeline steps 2–4: read one source file by its definition.
//
//  2. find the sheet and the header row; every column and every formula reference must exist,
//     otherwise a BLOCKING error names the source and the column
//  3. filter rows with the row filter (counted, never dropped silently)
//  4. select + rename + calculated columns, convert types (unreadable value → blank + counted)
//
// Formulas here (row filter, calculated columns) read the file's ORIGINAL headers (or column letters), and
// calculated columns may also use the renamed columns. Money is seen in rupees and stored as paise.

import type * as XLSX from 'xlsx';
import { ColumnIndex, compileFormula, describeFormulaError, toBool, type CompiledFormula, type FormulaParams, type Value } from '@/formula';
import { convertValue, isBlankCell } from '@/excel/convert';
import { detectHeaderRow, headersAt } from '@/excel/detectHeader';
import { isPatientColumn, patientColumnMessage } from '@/excel/patient';
import { listSheets, readSheetRows, WorkbookReadError, type CellValue, type Row, type SheetRows } from '@/excel/readWorkbook';
import type { ColumnType, SourceDef } from '@/recipe/schema';
import { FILE_COLUMN, ROW_COLUMN, SOURCE_COLUMN, type ColumnDef, type Issue, type ReadSourceResult, type SourceRow, type SourceStats, type Typed, type UnreadableValue } from './types';

export type SourceFile = { name: string; workbook: XLSX.WorkBook };

const MAX_LISTED = 200;
const MAX_FOOTER = 50;
const MAX_DUPLICATE_EXAMPLES = 20;
const RESERVED = [SOURCE_COLUMN, FILE_COLUMN, ROW_COLUMN].map((n) => n.toUpperCase());

const emptyStats = (): SourceStats => ({ read: 0, filtered: 0, used: 0, blank: 0, filterErrors: 0, unreadableByColumn: {}, duplicateRows: 0 });

/** The sheet to read: by name (exact, then ignoring case), else by position, else the first one with data. */
function pickSheet(wb: XLSX.WorkBook, def: SourceDef): { name: string } | { error: string } {
  const names = wb.SheetNames;
  const { name, index } = def.sheet;
  if (name !== undefined && name !== '') {
    const hit = names.find((n) => n === name) ?? names.find((n) => n.toUpperCase() === name.toUpperCase());
    if (hit) return { name: hit };
    return { error: `${def.label}: the sheet “${name}” was not found. Sheets in this file: ${names.map((n) => `“${n}”`).join(', ')}. Pick the right sheet in Sources.` };
  }
  if (index !== undefined) {
    const hit = names[index];
    return hit ? { name: hit } : { error: `${def.label}: this file has no sheet number ${index + 1}. Pick the right sheet in Sources.` };
  }
  const withData = listSheets(wb).find((s) => s.rowCount > 0);
  const first = withData?.name ?? names[0];
  return first ? { name: first } : { error: `${def.label}: the file has no sheets.` };
}

/** Formula text with its columns checked. Returns null (and records the problems) when it cannot be used. */
function prepareFormula(
  text: string,
  what: string,
  def: SourceDef,
  exists: (name: string) => boolean,
  headerOf: (name: string) => string | null,
  errors: Issue[],
): CompiledFormula | null {
  let formula: CompiledFormula;
  try {
    formula = compileFormula(text);
  } catch (err) {
    errors.push({ level: 'error', sourceId: def.id, message: `${def.label}: ${what} is not a valid formula: ${describeFormulaError(err)}` });
    return null;
  }
  let usable = true;
  for (const column of formula.columns) {
    if (!exists(column)) {
      usable = false;
      errors.push({
        level: 'error',
        sourceId: def.id,
        column,
        message: `${def.label}: ${what} uses [${column}], but column ${column} was not found. Pick the new column in Sources.`,
      });
    } else {
      const header = headerOf(column);
      if (header !== null && isPatientColumn(header)) {
        usable = false;
        errors.push({ level: 'error', sourceId: def.id, column, message: `${def.label}: ${patientColumnMessage(header)}` });
      }
    }
  }
  return usable ? formula : null;
}

export function readSource(file: SourceFile, def: SourceDef, params: FormulaParams = {}): ReadSourceResult {
  const result: ReadSourceResult = {
    sourceId: def.id,
    label: def.label,
    sheet: '',
    headerRow: 0,
    columns: [],
    rows: [],
    stats: emptyStats(),
    unreadable: [],
    footerRows: [],
    duplicates: [],
    formulaCellsWithoutValue: 0,
    errors: [],
  };
  const fail = (...issues: Issue[]): ReadSourceResult => ({ ...result, rows: [], footerRows: [], errors: [...result.errors, ...issues] });
  const error = (message: string, column?: string): Issue => ({ level: 'error', sourceId: def.id, message, ...(column ? { column } : {}) });

  // --- sheet and header ------------------------------------------------------
  const picked = pickSheet(file.workbook, def);
  if ('error' in picked) return fail(error(picked.error));
  result.sheet = picked.name;

  let sheet: SheetRows;
  try {
    sheet = readSheetRows(file.workbook, picked.name);
  } catch (err) {
    if (err instanceof WorkbookReadError) return fail(error(`${def.label}: ${err.message}`));
    throw err;
  }

  const headerRow = def.headerRow === 'auto' ? detectHeaderRow(sheet.rows) : def.headerRow;
  if (headerRow === null) return fail(error(`${def.label}: no header row was found in the sheet “${picked.name}”. Set the header row in Sources.`));
  if (headerRow > sheet.rows.length) {
    return fail(error(`${def.label}: the header row is ${headerRow}, but the sheet “${picked.name}” has only ${sheet.rows.length} rows. Fix the header row in Sources.`));
  }
  result.headerRow = headerRow;
  result.formulaCellsWithoutValue = sheet.stats.formulaCellsWithoutValue;
  const header = headersAt(sheet.rows, headerRow);
  const cols = new ColumnIndex(header.headers);

  // --- check the definition against this file -------------------------------
  const errors: Issue[] = [];
  const picks = def.columns.map((c) => ({ ...c, index: cols.find(c.from) }));
  for (const c of picks) {
    if (c.index === null) {
      errors.push(error(`${def.label}: column ${c.from} not found. Pick the new column in Sources.`, c.from));
    } else if (isPatientColumn(header.rawHeaders[c.index] ?? '')) {
      errors.push(error(`${def.label}: ${patientColumnMessage(header.rawHeaders[c.index] ?? c.from)}`, c.from));
    }
  }

  const known = new Map<string, ColumnType>(); // renamed and calculated names (upper case) → type, in order
  const columns: ColumnDef[] = [];
  const addColumn = (name: string, type: ColumnType) => {
    const key = name.toUpperCase();
    if (RESERVED.includes(key)) errors.push(error(`${def.label}: “${name}” is a name the app uses itself. Choose another name in Sources.`, name));
    else if (known.has(key)) errors.push(error(`${def.label}: two columns are called “${name}”. Give them different names in Sources.`, name));
    known.set(key, type);
    columns.push({ name, type });
  };
  for (const c of picks) addColumn(c.as, c.type);

  const originalExists = (n: string) => cols.find(n) !== null;
  const originalHeader = (n: string) => {
    const i = cols.find(n);
    return i === null ? null : (header.rawHeaders[i] ?? n);
  };

  const filter = def.rowFilter ? prepareFormula(def.rowFilter, 'the row filter', def, originalExists, originalHeader, errors) : null;

  const calcs: { as: string; type: ColumnType; formula: CompiledFormula | null }[] = [];
  for (const c of def.calculated) {
    // A calculated column may use the file's own columns and the renamed / earlier calculated ones.
    const formula = prepareFormula(c.formula, `the formula for ${c.as}`, def, (n) => known.has(n.toUpperCase()) || originalExists(n), (n) => (known.has(n.toUpperCase()) ? null : originalHeader(n)), errors);
    calcs.push({ as: c.as, type: c.type, formula });
    addColumn(c.as, c.type);
  }
  result.columns = columns;

  let uniqueName: string | null = null;
  if (def.uniqueColumn) {
    const wanted = def.uniqueColumn.toUpperCase();
    uniqueName = columns.find((c) => c.name.toUpperCase() === wanted)?.name ?? picks.find((c) => c.from.toUpperCase() === wanted)?.as ?? null;
    if (uniqueName === null) errors.push(error(`${def.label}: the duplicate check uses column ${def.uniqueColumn}, which is not one of this source's columns. Fix it in Sources.`, def.uniqueColumn));
  }

  if (errors.length > 0) return fail(...errors);

  // --- read the rows -----------------------------------------------------------
  const stats = result.stats;
  const money = new Set(columns.filter((c) => c.type === 'money').map((c) => c.name.toUpperCase()));
  const typedNames = new Map(columns.map((c) => [c.name.toUpperCase(), c.name] as const));

  const noteUnreadable = (row: number, column: string, raw: string | null, reason: UnreadableValue['reason'], message?: string) => {
    stats.unreadableByColumn[column] = (stats.unreadableByColumn[column] ?? 0) + 1;
    if (result.unreadable.length < MAX_LISTED) result.unreadable.push({ row, column, raw, reason, ...(message ? { message } : {}) });
  };

  /** Converts the declared columns of one raw row. Calculated columns are added by the caller. */
  const convertDeclared = (raw: Row, excelRow: number, values: Record<string, Typed>, count: boolean) => {
    for (const c of picks) {
      const cv = convertValue(raw[c.index as number], c.type);
      values[c.as] = cv.value;
      if (cv.status === 'unreadable' && count) noteUnreadable(excelRow, c.as, cv.raw, 'unreadable');
    }
  };

  const trailing: { row: number; raw: Row }[] = [];
  const kept: SourceRow[] = [];

  for (let r = headerRow; r < sheet.rows.length; r++) {
    const raw = sheet.rows[r] as Row;
    const excelRow = r + 1;
    if (raw.every(isBlankCell)) {
      stats.blank++;
      continue;
    }
    stats.read++;

    let keep = true;
    if (filter) {
      try {
        keep = toBool(filter.evaluate(cols.forRow(raw as Value[], params)));
      } catch (err) {
        keep = false;
        stats.filterErrors++;
        stats.filtered++;
        noteUnreadable(excelRow, '(row filter)', null, 'formulaError', describeFormulaError(err));
        trailing.length = 0; // a row that could not be judged is not a footer
        continue;
      }
    }
    if (!keep) {
      stats.filtered++;
      trailing.push({ row: excelRow, raw });
      if (trailing.length > MAX_FOOTER) trailing.shift();
      continue;
    }
    trailing.length = 0;

    const values: Record<string, Typed> = {};
    convertDeclared(raw, excelRow, values, true);

    for (const calc of calcs) {
      if (!calc.formula) continue; // unreachable: a bad formula is a blocking error above
      let out: Typed = null;
      try {
        const ctx = {
          getColumn: (name: string): Value | undefined => {
            const typedKey = typedNames.get(name.toUpperCase());
            if (typedKey !== undefined) {
              const v = values[typedKey] ?? null;
              return money.has(typedKey.toUpperCase()) && typeof v === 'number' ? v / 100 : v;
            }
            const i = cols.find(name);
            return i === null ? undefined : (raw[i] ?? null);
          },
          getParam: (name: string) => params[name] ?? Object.entries(params).find(([k]) => k.toUpperCase() === name.toUpperCase())?.[1],
        };
        const cv = convertValue(calc.formula.evaluate(ctx) as CellValue, calc.type);
        out = cv.value;
        if (cv.status === 'unreadable') noteUnreadable(excelRow, calc.as, cv.raw, 'unreadable');
      } catch (err) {
        noteUnreadable(excelRow, calc.as, null, 'formulaError', describeFormulaError(err));
      }
      values[calc.as] = out;
    }
    kept.push({ row: excelRow, values });
  }

  stats.used = kept.length;
  result.rows = kept;

  // Rows left out at the very end are normally the export's grand-total row. Keep their values for the tie-out.
  for (const t of trailing) {
    const values: Record<string, Typed> = {};
    convertDeclared(t.raw, t.row, values, false);
    result.footerRows.push({ row: t.row, values });
  }

  if (uniqueName !== null) {
    const seen = new Map<string, number[]>();
    for (const row of kept) {
      const v = row.values[uniqueName];
      if (v === null || v === undefined || v === '') continue;
      const key = String(v);
      const list = seen.get(key);
      if (list) list.push(row.row);
      else seen.set(key, [row.row]);
    }
    for (const [value, rows] of seen) {
      if (rows.length < 2) continue;
      stats.duplicateRows += rows.length;
      if (result.duplicates.length < MAX_DUPLICATE_EXAMPLES) result.duplicates.push({ value, rows });
    }
  }

  return result;
}
