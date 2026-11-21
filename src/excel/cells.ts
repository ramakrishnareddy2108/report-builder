// Turning engine values into Excel cell values. This is the ONLY place paise become rupees.

import type { ColumnType } from '@/recipe/schema';
import { escapeCell } from './escape';

export type OutValue = string | number | Date | null;

/** Money → rupees (paise / 100), dates → real Excel dates, text → escaped so Excel never runs it as a formula. */
export function toCellValue(value: string | number | null | undefined, type: ColumnType): OutValue {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return type === 'money' ? value / 100 : value;
  if (type === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    // Midnight UTC, so the day never slips back when Excel shows it.
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  return escapeCell(value);
}

export const NUMBER_FORMATS: Readonly<Record<ColumnType, string | undefined>> = {
  money: '#,##0.00;[Red]-#,##0.00',
  number: '#,##0.##;[Red]-#,##0.##',
  date: 'dd-mmm-yyyy',
  text: undefined,
};

/** A sheet name Excel accepts (no : \ / ? * [ ], at most 31 characters) that is not used yet. */
export function uniqueSheetName(taken: Iterable<string>, wanted: string): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  const clean = wanted.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let name = clean;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${clean.slice(0, 31 - String(n).length - 3)} (${n})`;
  return name;
}
