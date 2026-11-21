// Calendar dates in India Standard Time (Asia/Kolkata, UTC+05:30, no daylight saving).
//
// SheetJS returns Excel dates as JS Dates, e.g. 2026-10-11T18:30:00Z for
// 12 Oct IST midnight. The calendar day is therefore read in IST, never by
// slicing the UTC ISO string.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export type DateParts = { year: number; month: number; day: number };

const MONTH_NUMBERS: Readonly<Record<string, number>> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** True when day/month/year form a real calendar date. */
function isRealDate({ year, month, day }: DateParts): boolean {
  if (month < 1 || month > 12 || day < 1 || year < 1900 || year > 2200) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Calendar day of a Date in IST; null for an invalid Date. */
export function istDateParts(date: Date): DateParts | null {
  if (Number.isNaN(date.getTime())) return null;
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

export function partsToIso({ year, month, day }: DateParts): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/**
 * Reads text dates: `02-OCT-2026` (HIS text dates), `2026-10-02`,
 * `02/10/2026` and `02-10-2026` (day first). Returns an ISO date or null.
 */
export function parseDateText(text: string): string | null {
  const s = text.trim();
  let parts: DateParts | null = null;

  let m = /^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ,]+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTH_NUMBERS[(m[2] as string).slice(0, 3).toUpperCase()];
    if (month !== undefined) parts = { year: Number(m[3]), month, day: Number(m[1]) };
  }
  if (!parts && (m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s))) {
    parts = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  }
  if (!parts && (m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) {
    parts = { year: Number(m[3]), month: Number(m[2]), day: Number(m[1]) };
  }
  return parts && isRealDate(parts) ? partsToIso(parts) : null;
}

/** Calendar day of a Date or date text; null when it is neither. */
export function toDateParts(value: unknown): DateParts | null {
  if (value instanceof Date) return istDateParts(value);
  if (typeof value === 'string') {
    const iso = parseDateText(value);
    if (iso) return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)), day: Number(iso.slice(8, 10)) };
  }
  return null;
}

/** ISO date (YYYY-MM-DD) of a Date (read in IST) or date text; null when it is neither. */
export function toIsoDate(value: unknown): string | null {
  const parts = toDateParts(value);
  return parts ? partsToIso(parts) : null;
}

/** 'YYYY-MM' of an ISO date. */
export function monthOfIso(iso: string): string {
  return iso.slice(0, 7);
}

/** The month before 'YYYY-MM' ("2026-01" -> "2025-12"). */
export function previousMonth(month: string): string {
  const [y = 0, m = 1] = month.split('-').map(Number);
  return m === 1 ? `${pad(y - 1, 4)}-12` : `${pad(y, 4)}-${pad(m - 1)}`;
}

/** The month the reports are normally made for: the calendar month before today (in IST). */
export function defaultReportMonth(today: Date = new Date()): string {
  const parts = istDateParts(today);
  return previousMonth(`${pad(parts?.year ?? 1970, 4)}-${pad(parts?.month ?? 1)}`);
}
