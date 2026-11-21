// The function registry. Eager functions get evaluated arguments; lazy ones
// (IF, IFS, IFERROR, AND, OR) get thunks and evaluate only what they need.

import { toDateParts } from '@/core/dates';
import { checkNumber, clean, isBlank, parseNumberText, toBool, toNumber, toText } from './coerce';
import { FormulaError, type Value } from './types';

export type Thunk = () => Value;

type Common = { min: number; max: number };
export type FunctionDef =
  | (Common & { lazy?: false; fn: (args: Value[]) => Value })
  | (Common & { lazy: true; fn: (args: Thunk[]) => Value });

const MANY = Number.POSITIVE_INFINITY;

// --- helpers ------------------------------------------------------------------

/** Rounds half away from zero to `digits` decimals (negative digits round to tens, hundreds ...). */
function roundTo(n: number, digits: number, mode: 'round' | 'up' | 'down'): number {
  const d = Math.trunc(digits);
  const scale = 10 ** Math.abs(d);
  const scaled = clean(d >= 0 ? n * scale : n / scale);
  const abs = Math.abs(scaled);
  const rounded = Math.sign(scaled) * (mode === 'round' ? Math.round(abs) : mode === 'up' ? Math.ceil(abs) : Math.floor(abs));
  return checkNumber(clean(d >= 0 ? rounded / scale : rounded * scale));
}

/** Digits argument of ROUND*: defaults to 0. */
const digitsArg = (v: Value | undefined): number => (v === undefined ? 0 : toNumber(v));

const numbers = (args: Value[]): number[] => args.map(toNumber);

function count(v: Value | undefined, fallback: number): number {
  const n = v === undefined ? fallback : Math.trunc(toNumber(v));
  if (n < 0) throw new FormulaError('#VALUE!', 'A length or position cannot be negative');
  return n;
}

function datePart(v: Value, part: 'year' | 'month' | 'day'): number {
  const parts = toDateParts(v);
  if (!parts) throw new FormulaError('#VALUE!', `"${toText(v)}" is not a date`);
  return parts[part];
}

function searchIn(find: string, within: string, start: number): number {
  if (start < 1 || start > within.length + 1) throw new FormulaError('#VALUE!', 'The start position is outside the text');
  const at = within.toLowerCase().indexOf(find.toLowerCase(), start - 1);
  if (at === -1) throw new FormulaError('#VALUE!', `"${find}" was not found in the text`);
  return at + 1;
}

const properCase = (s: string) => s.toLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());

// --- registry -----------------------------------------------------------------

export const FUNCTIONS: Readonly<Record<string, FunctionDef>> = {
  // logic
  IF: { min: 2, max: 3, lazy: true, fn: ([cond, yes, no]) => (toBool((cond as Thunk)()) ? (yes as Thunk)() : no ? no() : false) },
  IFS: {
    min: 2,
    max: MANY,
    lazy: true,
    fn: (args) => {
      if (args.length % 2 !== 0) throw new FormulaError('#VALUE!', 'IFS needs pairs of a condition and a result');
      for (let i = 0; i < args.length; i += 2) {
        if (toBool((args[i] as Thunk)())) return (args[i + 1] as Thunk)();
      }
      throw new FormulaError('#N/A', 'IFS: none of the conditions was true');
    },
  },
  IFERROR: {
    min: 2,
    max: 2,
    lazy: true,
    fn: ([value, fallback]) => {
      try {
        return (value as Thunk)();
      } catch (err) {
        // A missing column or unknown function is a setup mistake: never hide it.
        if (err instanceof FormulaError && err.code !== '#REF!' && err.code !== '#NAME?') return (fallback as Thunk)();
        throw err;
      }
    },
  },
  AND: { min: 1, max: MANY, lazy: true, fn: (args) => args.every((a) => toBool(a())) },
  OR: { min: 1, max: MANY, lazy: true, fn: (args) => args.some((a) => toBool(a())) },
  NOT: { min: 1, max: 1, fn: ([a]) => !toBool(a as Value) },

  // maths
  ROUND: { min: 1, max: 2, fn: ([n, d]) => roundTo(toNumber(n as Value), digitsArg(d), 'round') },
  ROUNDUP: { min: 1, max: 2, fn: ([n, d]) => roundTo(toNumber(n as Value), digitsArg(d), 'up') },
  ROUNDDOWN: { min: 1, max: 2, fn: ([n, d]) => roundTo(toNumber(n as Value), digitsArg(d), 'down') },
  INT: { min: 1, max: 1, fn: ([n]) => Math.floor(clean(toNumber(n as Value))) },
  ABS: { min: 1, max: 1, fn: ([n]) => Math.abs(toNumber(n as Value)) },
  MIN: { min: 1, max: MANY, fn: (args) => Math.min(...numbers(args)) },
  MAX: { min: 1, max: MANY, fn: (args) => Math.max(...numbers(args)) },
  SUM: { min: 1, max: MANY, fn: (args) => checkNumber(clean(numbers(args).reduce((a, b) => a + b, 0))) },
  AVERAGE: { min: 1, max: MANY, fn: (args) => checkNumber(clean(numbers(args).reduce((a, b) => a + b, 0) / args.length)) },
  MOD: {
    min: 2,
    max: 2,
    fn: ([n, d]) => {
      const divisor = toNumber(d as Value);
      if (divisor === 0) throw new FormulaError('#DIV/0!', 'Cannot divide by zero');
      const x = toNumber(n as Value);
      return checkNumber(clean(x - divisor * Math.floor(clean(x / divisor)))); // result has the divisor's sign
    },
  },

  // text
  UPPER: { min: 1, max: 1, fn: ([s]) => toText(s as Value).toUpperCase() },
  LOWER: { min: 1, max: 1, fn: ([s]) => toText(s as Value).toLowerCase() },
  PROPER: { min: 1, max: 1, fn: ([s]) => properCase(toText(s as Value)) },
  TRIM: { min: 1, max: 1, fn: ([s]) => toText(s as Value).replace(/\s+/g, ' ').trim() },
  LEFT: { min: 1, max: 2, fn: ([s, n]) => toText(s as Value).slice(0, count(n, 1)) },
  RIGHT: {
    min: 1,
    max: 2,
    fn: ([s, n]) => {
      const text = toText(s as Value);
      const k = count(n, 1);
      return k === 0 ? '' : text.slice(-k);
    },
  },
  MID: {
    min: 3,
    max: 3,
    fn: ([s, start, len]) => {
      const from = count(start, 1);
      if (from < 1) throw new FormulaError('#VALUE!', 'MID starts counting at 1');
      return toText(s as Value).slice(from - 1, from - 1 + count(len, 0));
    },
  },
  LEN: { min: 1, max: 1, fn: ([s]) => toText(s as Value).length },
  CONCAT: { min: 1, max: MANY, fn: (args) => args.map(toText).join('') },
  SUBSTITUTE: {
    min: 3,
    max: 4,
    fn: ([s, from, to, instance]) => {
      const text = toText(s as Value);
      const find = toText(from as Value);
      const replacement = toText(to as Value);
      if (find === '') return text;
      if (instance === undefined) return text.split(find).join(replacement);
      const n = count(instance, 1);
      if (n < 1) throw new FormulaError('#VALUE!', 'The occurrence number must be 1 or more');
      let at = -1;
      for (let k = 0; k < n; k++) {
        at = text.indexOf(find, at + 1);
        if (at === -1) return text;
      }
      return text.slice(0, at) + replacement + text.slice(at + find.length);
    },
  },
  SEARCH: { min: 2, max: 3, fn: ([find, within, start]) => searchIn(toText(find as Value), toText(within as Value), count(start, 1)) },
  CONTAINS: { min: 2, max: 2, fn: ([within, find]) => toText(within as Value).toLowerCase().includes(toText(find as Value).toLowerCase()) },

  // checks
  ISBLANK: { min: 1, max: 1, fn: ([v]) => isBlank(v as Value) },
  ISNUMBER: { min: 1, max: 1, fn: ([v]) => typeof v === 'number' },
  VALUE: {
    min: 1,
    max: 1,
    fn: ([v]) => {
      if (typeof v === 'number') return v;
      if (v === null || (typeof v === 'string' && v.trim() === '')) return 0;
      const n = typeof v === 'string' ? parseNumberText(v) : null;
      if (n === null) throw new FormulaError('#VALUE!', `"${toText(v as Value)}" cannot be turned into a number`);
      return n;
    },
  },

  // dates
  YEAR: { min: 1, max: 1, fn: ([v]) => datePart(v as Value, 'year') },
  MONTH: { min: 1, max: 1, fn: ([v]) => datePart(v as Value, 'month') },
  DAY: { min: 1, max: 1, fn: ([v]) => datePart(v as Value, 'day') },
};

