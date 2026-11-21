// Turn a raw cell into a typed value for the combined table.
//
//   text   → trimmed string ("" is blank; whole numbers lose a trailing ".0")
//   number → a number; text like "1,234.5" is read; anything else is unreadable
//   money  → integer PAISE (never a float), see core/money
//   date   → an ISO date "YYYY-MM-DD"; Excel dates are read as calendar days in India (IST),
//            text dates may be 02-OCT-2026, 02-10-2026 or 2026-10-02
//
// Nothing is dropped silently: a value that is not blank but cannot be read comes back with
// status 'unreadable' (and the value blank), so the caller can count it and show it in the Checks.

import { toIsoDate } from '@/core/dates';
import { parseMoney } from '@/core/money';
import { parseNumberText } from '@/formula/coerce';
import type { ColumnType } from '@/recipe/schema';
import type { CellValue } from './readWorkbook';

export type Typed = string | number | null;

export type Converted = {
  value: Typed;
  /** blank = nothing there; unreadable = something is there but it is not a valid value of this type. */
  status: 'ok' | 'blank' | 'unreadable';
  /** The cell as read, shortened, for messages about unreadable values. */
  raw: string | null;
};

const MAX_RAW = 40;

/** A cell as short text for a message. */
export function describeRaw(v: CellValue | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = v instanceof Date ? (toIsoDate(v) ?? String(v)) : String(v);
  return s.length > MAX_RAW ? `${s.slice(0, MAX_RAW)}…` : s;
}

export function isBlankCell(v: CellValue | undefined): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

const ok = (value: string | number, raw: CellValue): Converted => ({ value, status: 'ok', raw: describeRaw(raw) });
const BLANK: Converted = { value: null, status: 'blank', raw: null };
const unreadable = (raw: CellValue): Converted => ({ value: null, status: 'unreadable', raw: describeRaw(raw) });

export function convertValue(raw: CellValue | undefined, type: ColumnType): Converted {
  if (isBlankCell(raw)) return BLANK;
  const v = raw as Exclude<CellValue, null>;

  switch (type) {
    case 'text': {
      if (v instanceof Date) {
        const iso = toIsoDate(v);
        return iso ? ok(iso, v) : unreadable(v);
      }
      if (typeof v === 'number') return ok(String(Number(v.toPrecision(15))), v);
      if (typeof v === 'boolean') return ok(v ? 'TRUE' : 'FALSE', v);
      return ok(v.trim(), v);
    }
    case 'number': {
      if (typeof v === 'number') return Number.isFinite(v) ? ok(v, v) : unreadable(v);
      if (typeof v === 'string') {
        const n = parseNumberText(v);
        return n === null ? unreadable(v) : ok(n, v);
      }
      return unreadable(v);
    }
    case 'money': {
      const r = parseMoney(v);
      if (r.ok) return ok(r.paise, v);
      return r.reason === 'blank' ? BLANK : unreadable(v);
    }
    case 'date': {
      const iso = toIsoDate(v);
      return iso ? ok(iso, v) : unreadable(v);
    }
  }
}
