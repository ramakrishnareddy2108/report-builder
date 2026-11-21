// Paise helpers: convert rupees to integer paise once on read; format only at display/export.
//
// Rounding is half away from zero (1.005 → 101 paise, -1.005 → -101 paise).
// Numbers are first trimmed to 15 significant digits, as Excel does, so binary
// noise like 1.00499999999 (stored for 1.005) does not change the paise.

export type MoneyParseResult =
  | { ok: true; paise: number }
  | { ok: false; reason: 'blank' | 'invalid' };

const BLANK: MoneyParseResult = { ok: false, reason: 'blank' };
const INVALID: MoneyParseResult = { ok: false, reason: 'invalid' };

/** Largest rupee integer part we accept from text (keeps paise a safe integer). */
const MAX_RUPEE_DIGITS = 13;

/** Integer part with commas: Western (1,234,567) or Indian (12,34,567) grouping. */
const WESTERN_GROUPS = /^\d{1,3}(,\d{3})+$/;
const INDIAN_GROUPS = /^\d{1,2}(,\d{2})*,\d{3}$/;
const BODY = /^(\d[\d,]*)?(?:\.(\d*))?$/;
const CURRENCY_PREFIX = /^(₹|rs\.?|inr)/i;
const WHITESPACE = /[\s  ]/g;
const MINUS_SIGNS = /^[-−]/;

function normaliseZero(n: number): number {
  return n === 0 ? 0 : n; // turns -0 into 0
}

function roundHalfAwayFromZero(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n));
}

function parseNumber(value: number): MoneyParseResult {
  if (!Number.isFinite(value)) return INVALID;
  const scaled = Number((value * 100).toPrecision(15));
  const paise = normaliseZero(roundHalfAwayFromZero(scaled));
  return Number.isSafeInteger(paise) ? { ok: true, paise } : INVALID;
}

function parseText(raw: string): MoneyParseResult {
  let t = raw.replace(WHITESPACE, '');
  if (t === '') return BLANK;

  // "Rs. 1,500/-" is a common Indian way of writing an amount.
  if (t.endsWith('/-')) t = t.slice(0, -2);

  // Strip a currency symbol, a sign and outer parentheses, in any order, once each.
  let negative = false;
  let seenCurrency = false;
  let seenSign = false;
  let seenParens = false;
  for (let changed = true; changed; ) {
    changed = false;
    if (!seenCurrency && CURRENCY_PREFIX.test(t)) {
      t = t.replace(CURRENCY_PREFIX, '');
      seenCurrency = changed = true;
    }
    if (!seenSign && !seenParens && (MINUS_SIGNS.test(t) || t.startsWith('+'))) {
      negative = MINUS_SIGNS.test(t);
      t = t.slice(1);
      seenSign = changed = true;
    }
    if (!seenParens && !seenSign && t.startsWith('(') && t.endsWith(')')) {
      t = t.slice(1, -1);
      negative = true;
      seenParens = changed = true;
    }
  }

  const match = BODY.exec(t);
  if (!match) return INVALID;
  const intWithCommas = match[1] ?? '';
  const frac = match[2] ?? '';
  if (intWithCommas === '' && frac === '') return INVALID; // "", ".", "₹"
  if (
    intWithCommas.includes(',') &&
    !WESTERN_GROUPS.test(intWithCommas) &&
    !INDIAN_GROUPS.test(intWithCommas)
  ) {
    return INVALID; // e.g. "1,2" or "12,34" — too ambiguous to trust
  }

  const intDigits = intWithCommas.replace(/,/g, '').replace(/^0+(?=\d)/, '');
  if (intDigits.length > MAX_RUPEE_DIGITS) return INVALID;

  // Exact decimal arithmetic on the digit strings: no float is involved.
  const paiseDigits = (frac + '00').slice(0, 2);
  const roundUp = frac.length > 2 && Number(frac[2]) >= 5 ? 1 : 0;
  const magnitude = Number(intDigits || '0') * 100 + Number(paiseDigits) + roundUp;
  return { ok: true, paise: normaliseZero(negative ? -magnitude : magnitude) };
}

/**
 * Parses a cell value into integer paise and says why when it cannot.
 * Blank (null, undefined, empty or whitespace-only text) is reported separately
 * from invalid so callers can decide whether blank means 0.
 */
export function parseMoney(value: unknown): MoneyParseResult {
  if (value === null || value === undefined) return BLANK;
  if (typeof value === 'number') return parseNumber(value);
  if (typeof value === 'string') return parseText(value);
  return INVALID; // booleans, Dates, objects, bigint ...
}

/**
 * Converts rupees (a number, or text like "₹1,23,456.78", "Rs. 500", "(123)")
 * to integer paise. Returns null for blank or unreadable input.
 */
export function toPaise(value: unknown): number | null {
  const result = parseMoney(value);
  return result.ok ? result.paise : null;
}

function assertPaise(paise: number, where: string): void {
  if (!Number.isSafeInteger(paise)) {
    throw new TypeError(`${where}: expected integer paise, got ${String(paise)}`);
  }
}

const IN_GROUPING = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export type FormatINROptions = {
  /** Prefix with ₹ (default true). */
  symbol?: boolean;
};

/** Formats paise as Indian rupees, e.g. 12345678 → "₹1,23,456.78", -50 → "-₹0.50". */
export function formatINR(paise: number, options: FormatINROptions = {}): string {
  assertPaise(paise, 'formatINR');
  const { symbol = true } = options;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  const sign = paise < 0 ? '-' : '';
  return `${sign}${symbol ? '₹' : ''}${IN_GROUPING.format(rupees)}.${rest}`;
}

/** Sums integer paise. Throws if any value is not a safe integer, so floats are never summed. */
export function sumPaise(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) {
    assertPaise(v, 'sumPaise');
    total += v;
  }
  assertPaise(total, 'sumPaise (total overflow)');
  return normaliseZero(total);
}

/** Paise → rupees, for writing numbers into Excel at export time only. */
export function paiseToRupees(paise: number): number {
  assertPaise(paise, 'paiseToRupees');
  return paise / 100;
}

/** Short Indian form for chart axes: 1,25,00,000 -> "₹1.25 Cr", 4,50,000 -> "₹4.5 L", 12,345 -> "₹12,345". Display only. */
export function formatCompactINR(paise: number): string {
  assertPaise(paise, 'formatCompactINR');
  const rupees = Math.abs(paise) / 100;
  const sign = paise < 0 ? '-' : '';
  const trim = (n: number) => String(Number(n.toFixed(2)));
  if (rupees >= 1e7) return `${sign}₹${trim(rupees / 1e7)} Cr`;
  if (rupees >= 1e5) return `${sign}₹${trim(rupees / 1e5)} L`;
  return `${sign}₹${IN_GROUPING.format(Math.round(rupees))}`;
}
