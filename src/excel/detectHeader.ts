// Find the header row of a sheet and turn it into unique column names.

import type { CellValue } from './readWorkbook';

export const HEADER_SCAN_ROWS = 20;

export type HeaderDetection = {
  /** 1-based Excel row number of the header row. */
  headerRow: number;
  /** One unique name per column (index 0 = column A). */
  headers: string[];
  /** Header text as it appears (trimmed, inner spaces collapsed); '' for blanks. */
  rawHeaders: string[];
  /** Non-numeric text cells counted on the header row. */
  textCells: number;
};

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** "A" → 0, "AH" → 33. Returns null for anything that is not a column letter. */
export function columnIndex(letter: string): number | null {
  const s = letter.trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(s)) return null;
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function cleanHeaderText(v: CellValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, ' ').trim();
}

const NUMERIC_TEXT = /^[-+]?[₹$]?\s*[\d,]*\.?\d+%?$/;
const DATE_TEXT = /^\d{1,4}[-/.](\d{1,2}|[A-Za-z]{3,9})[-/.]\d{1,4}/;

/** A text cell that is not a number or a date written as text. */
export function isHeaderLikeText(v: CellValue | undefined): boolean {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  return s !== '' && !NUMERIC_TEXT.test(s) && !DATE_TEXT.test(s);
}

/**
 * The header is the row among the first `scanRows` with the most non-numeric
 * text cells; ties go to the earliest row. Returns a 1-based Excel row, or null
 * when no row holds any text.
 */
export function detectHeaderRow(rows: readonly (readonly CellValue[])[], scanRows = HEADER_SCAN_ROWS): number | null {
  let best: number | null = null;
  let bestCount = 0;
  const n = Math.min(rows.length, scanRows);
  for (let r = 0; r < n; r++) {
    const count = (rows[r] ?? []).filter(isHeaderLikeText).length;
    if (count > bestCount) {
      best = r + 1;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Unique names for a header row: blanks become "Column F"; repeats get a
 * suffix, so the second ADMISSIONDT becomes "ADMISSIONDT (2)". Comparison
 * ignores case.
 */
export function makeUniqueHeaders(raw: readonly CellValue[], columnCount = raw.length): string[] {
  const used = new Set<string>();
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (let c = 0; c < columnCount; c++) {
    const text = cleanHeaderText(raw[c]);
    let name: string;
    if (text === '') {
      name = `Column ${columnLetter(c)}`;
    } else {
      const key = text.toUpperCase();
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      name = n === 1 ? text : `${text} (${n})`;
    }
    // Guard against a real header that already looks like a generated name.
    let candidate = name;
    let k = 2;
    while (used.has(candidate.toUpperCase())) candidate = `${name} (${k++})`;
    used.add(candidate.toUpperCase());
    out.push(candidate);
  }
  return out;
}

/** Header names for a given (for example user-chosen) 1-based header row. */
export function headersAt(rows: readonly (readonly CellValue[])[], headerRow: number): HeaderDetection {
  const row = rows[headerRow - 1] ?? [];
  const columnCount = Math.max(row.length, ...rows.slice(0, HEADER_SCAN_ROWS).map((r) => r.length), 0);
  const rawHeaders = Array.from({ length: columnCount }, (_, c) => cleanHeaderText(row[c]));
  return {
    headerRow,
    headers: makeUniqueHeaders(row, columnCount),
    rawHeaders,
    textCells: row.filter(isHeaderLikeText).length,
  };
}

export function detectHeader(
  rows: readonly (readonly CellValue[])[],
  scanRows = HEADER_SCAN_ROWS,
): HeaderDetection | null {
  const headerRow = detectHeaderRow(rows, scanRows);
  return headerRow === null ? null : headersAt(rows, headerRow);
}

/**
 * Column index for a header name. `occurrence` picks the 1st/2nd/... column
 * with that name (for duplicate headers). Exact match first, then ignoring case.
 */
export function findHeaderColumn(rawHeaders: readonly string[], name: string, occurrence = 1): number | null {
  const target = cleanHeaderText(name);
  const find = (eq: (h: string) => boolean): number | null => {
    let seen = 0;
    for (let c = 0; c < rawHeaders.length; c++) {
      if (eq(rawHeaders[c] ?? '') && ++seen === occurrence) return c;
    }
    return null;
  };
  return find((h) => h === target) ?? find((h) => h.toUpperCase() === target.toUpperCase());
}
