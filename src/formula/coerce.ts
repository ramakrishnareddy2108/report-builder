// Turning values into numbers, text and true/false, and comparing them.
// Blank is 0 for numbers and "" for text.

import { toIsoDate } from '@/core/dates';
import { FormulaError, type Value } from './types';

/** Trims binary noise (0.1 + 0.2 → 0.3) the way Excel does: 15 significant digits. */
export function clean(n: number): number {
  return Number(n.toPrecision(15));
}

export function checkNumber(n: number): number {
  if (Number.isNaN(n)) throw new FormulaError('#NUM!', 'The result is not a number');
  if (!Number.isFinite(n)) throw new FormulaError('#NUM!', 'The result is too large');
  return n === 0 ? 0 : n;
}

const NUMERIC_TEXT = /^[-+]?(?:\d[\d,]*\.?\d*|\.\d+)(?:[eE][-+]?\d+)?%?$/;

/** Number in text such as "1,234.50" or "5%"; null if the text is not a number. */
export function parseNumberText(text: string): number | null {
  const s = text.trim();
  if (!NUMERIC_TEXT.test(s)) return null;
  const percent = s.endsWith('%');
  const n = Number((percent ? s.slice(0, -1) : s).replace(/,/g, ''));
  return Number.isFinite(n) ? (percent ? clean(n / 100) : n) : null;
}

export function toNumber(v: Value): number {
  if (v === null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    if (v.trim() === '') return 0;
    const n = parseNumberText(v);
    if (n === null) throw new FormulaError('#VALUE!', `"${v}" is not a number`);
    return n;
  }
  throw new FormulaError('#VALUE!', 'A date cannot be used as a number here');
}

export function toText(v: Value): string {
  if (v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(clean(v));
  return toIsoDate(v) ?? '';
}

export function toBool(v: Value): boolean {
  if (v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toUpperCase();
    if (s === 'TRUE') return true;
    if (s === 'FALSE' || s === '') return false;
  }
  throw new FormulaError('#VALUE!', `${typeof v === 'string' ? `"${v}"` : 'A date'} is not true or false`);
}

/** True for blank and for text with only spaces. */
export function isBlank(v: Value): boolean {
  return v === null || (typeof v === 'string' && v.trim() === '');
}

// Order across types, as in Excel: numbers < text < true/false.
const TYPE_ORDER = { number: 0, string: 1, boolean: 2 } as const;

function comparable(v: Value, other: Value): number | string | boolean {
  if (v === null) return typeof other === 'string' ? '' : typeof other === 'boolean' ? false : 0;
  if (v instanceof Date) return toIsoDate(v) ?? '';
  return v;
}

/** Negative, 0 or positive. Numbers compare numerically, text ignoring case. */
export function compareValues(a: Value, b: Value): number {
  let x = comparable(a, b);
  let y = comparable(b, a);
  // Text that looks like a number compares as a number against a real number.
  if (typeof x === 'string' && typeof y === 'number') {
    const n = parseNumberText(x);
    if (n !== null) x = n;
  } else if (typeof y === 'string' && typeof x === 'number') {
    const n = parseNumberText(y);
    if (n !== null) y = n;
  }
  if (typeof x === 'string' && typeof y === 'string') {
    const [p, q] = [x.toUpperCase(), y.toUpperCase()];
    return p < q ? -1 : p > q ? 1 : 0;
  }
  if (typeof x === typeof y) return Number(x) - Number(y);
  return TYPE_ORDER[typeof x as keyof typeof TYPE_ORDER] - TYPE_ORDER[typeof y as keyof typeof TYPE_ORDER];
}
