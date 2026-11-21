// Escape text written into Excel output so a spreadsheet never runs it as a formula.
//
// Text that starts with = + - @ (or a tab or carriage return, which Excel also
// accepts before a formula) gets a leading apostrophe. Numbers are never
// escaped: a negative amount is a number, not text.

const FORMULA_STARTERS = new Set(['=', '+', '-', '@', '\t', '\r']);

export function escapeExcelText(text: string): string {
  const first = text[0];
  return first !== undefined && FORMULA_STARTERS.has(first) ? `'${text}` : text;
}

/** Escape a cell value if it is text; numbers, dates and blanks pass through. */
export function escapeCell<T extends string | number | boolean | Date | null | undefined>(value: T): T | string {
  return typeof value === 'string' ? escapeExcelText(value) : value;
}
