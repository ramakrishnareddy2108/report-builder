// Column lookup for a sheet: [Name] resolves exactly, then ignoring case,
// then as an Excel column letter ([F], [AH]).

import { columnIndex } from '@/excel/detectHeader';
import type { FormulaContext, FormulaParams, Value } from './types';

/** Looks a parameter up by name, ignoring case. */
function paramLookup(params: FormulaParams | undefined): FormulaContext['getParam'] {
  if (!params) return undefined;
  const folded = new Map(Object.entries(params).map(([k, v]) => [k.toUpperCase(), v] as const));
  return (name) => folded.get(name.toUpperCase());
}

export class ColumnIndex {
  private readonly exact = new Map<string, number>();
  private readonly folded = new Map<string, number>();

  /** `headers` are the sheet's unique column names (index 0 = column A). */
  constructor(private readonly headers: readonly string[]) {
    headers.forEach((h, i) => {
      if (!this.exact.has(h)) this.exact.set(h, i);
      const key = h.toUpperCase();
      if (!this.folded.has(key)) this.folded.set(key, i);
    });
  }

  /** Column position for a name or letter; null if the sheet has no such column. */
  find(name: string): number | null {
    const hit = this.exact.get(name) ?? this.folded.get(name.toUpperCase());
    if (hit !== undefined) return hit;
    const letter = columnIndex(name);
    return letter !== null && letter < this.headers.length ? letter : null;
  }

  /** A formula context over one row (cells in column order). */
  forRow(row: readonly Value[], params?: FormulaParams): FormulaContext {
    return { getColumn: (name) => this.read(row, name), getParam: paramLookup(params) };
  }

  private read(row: readonly Value[], name: string): Value | undefined {
    const i = this.find(name);
    return i === null ? undefined : (row[i] ?? null);
  }
}

/** A context from named values, for rules that refer to field keys like [grossAmount]. */
export function recordContext(values: Readonly<Record<string, Value>>, params?: FormulaParams): FormulaContext {
  return { getColumn: (name) => (Object.hasOwn(values, name) ? values[name] : undefined), getParam: paramLookup(params) };
}
