// Small helpers the recipe builder uses to suggest things, so the user mostly just ticks and confirms.

import { toIsoDate } from '@/core/dates';
import { parseMoney } from '@/core/money';
import type { CellValue } from '@/excel/readWorkbook';
import type { ColumnType, SourceDef } from './schema';

const MONEY_WORDS = /amount|amt|value|cost|gross|net|concession|discount|price|revenue|fee|salary|incentive|total|rate|tax|paid|balance|due/i;
const ID_WORDS = /\b(no|number|id|code|umr|bill|mobile|phone|pin|age)\b|no$|nbr$|umr/i;

/**
 * A type for a column from its header and a sample of its values:
 * dates if most values are dates, money if the header sounds like an amount, numbers if all values are numbers.
 */
export function guessType(header: string, values: readonly CellValue[]): ColumnType {
  const filled = values.filter((v) => v !== null && !(typeof v === 'string' && v.trim() === ''));
  if (filled.length === 0) return 'text';
  const isDate = (v: CellValue) => v instanceof Date || (typeof v === 'string' && toIsoDate(v) !== null);
  if (filled.filter(isDate).length / filled.length >= 0.8) return 'date';
  const numeric = filled.filter((v) => typeof v === 'number' || (typeof v === 'string' && parseMoney(v).ok)).length / filled.length >= 0.8;
  if (!numeric) return 'text';
  if (ID_WORDS.test(header) && !MONEY_WORDS.test(header)) return 'text'; // a bill or UMR number is an ID, not an amount
  return MONEY_WORDS.test(header) ? 'money' : 'number';
}

/** "OP Billing Report" → "opBillingReport" (letters and digits only, starting with a lower-case letter). */
export function idFromLabel(label: string): string {
  const words = label.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const id = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0]?.toUpperCase() + w.slice(1).toLowerCase())).join('');
  return /^[a-z]/.test(id) ? id : `source${id}`;
}

/** An id that no source uses yet: "opBilling", then "opBilling2", "opBilling3"... */
export function uniqueSourceId(taken: readonly string[], wanted: string): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  let id = wanted;
  for (let n = 2; used.has(id.toLowerCase()); n++) id = `${wanted}${n}`;
  return id;
}

/** "IP Discharge Report Oct2026 (1).xlsx" → "IP Discharge Report": the file name without extension, months, years and numbers. */
export function labelFromFileName(fileName: string): string {
  const months = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec';
  const cleaned = fileName
    .replace(/\.[A-Za-z0-9]{2,5}$/, '')
    .replace(/\d+/g, ' ')
    .replace(new RegExp(`\\b(${months})\\b`, 'gi'), ' ')
    .replace(/[_()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned === '' ? 'New source' : cleaned.replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Ip|Op|Gst|Drr)\b/g, (m) => m.toUpperCase());
}

/** The headers a file must have to be treated as this source: the original header of every picked column. */
export function autoRequiredHeaders(source: Pick<SourceDef, 'columns'>): string[] {
  const out: string[] = [];
  for (const c of source.columns) {
    if (/^[A-Z]{1,3}$/.test(c.from)) continue; // a column letter says nothing about the file
    // "ADMISSIONDT (2)" is the app's name for the second ADMISSIONDT; the file only has "ADMISSIONDT".
    const header = c.from.replace(/\s*\(\d+\)$/, '');
    if (!out.some((h) => h.toUpperCase() === header.toUpperCase())) out.push(header);
  }
  return out;
}

/**
 * The name to suggest when a column is picked: the name another source already gives to a column with the same
 * header (so stacking lines up), otherwise the header itself.
 */
export function suggestName(header: string, others: readonly Pick<SourceDef, 'columns'>[]): string {
  for (const s of others) {
    const hit = s.columns.find((c) => c.from.toUpperCase() === header.toUpperCase());
    if (hit) return hit.as;
  }
  return header.replace(/\s*\(\d+\)$/, '').trim() || header;
}

/** Every common name used by the sources, for autocomplete. */
export function usedNames(sources: readonly Pick<SourceDef, 'columns' | 'calculated'>[]): string[] {
  const names = new Set<string>();
  for (const s of sources) {
    for (const c of s.columns) names.add(c.as);
    for (const c of s.calculated) names.add(c.as);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
