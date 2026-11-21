// Formula context over typed rows.
//
// Money is stored as integer paise, but a formula sees RUPEES (paise / 100), so `[Gross] - [Discount]`
// and `ROUND([Amount] * 0.18, 2)` mean what they say. A formula that produces a money value is turned
// back into integer paise (see excel/convert.ts), which also trims binary noise like 0.1 + 0.2.
// Dates are ISO text ("2026-10-02"), which the date functions (TEXT, YEAR, ...) and comparisons read.

import type { FormulaContext, FormulaParams, Value } from '@/formula';
import type { ColumnType, Parameter } from '@/recipe/schema';
import type { Typed } from './types';

type Entry = { key: string; type: ColumnType };

/** Values of the recipe parameters as formulas see them (a number parameter is a number). */
export function paramValues(
  parameters: readonly { name: string; type: Parameter['type'] }[],
  values: Readonly<Record<string, string>>,
): FormulaParams {
  const out: Record<string, Value> = {};
  for (const p of parameters) {
    const raw = values[p.name] ?? '';
    if (p.type === 'number' && raw.trim() !== '' && Number.isFinite(Number(raw))) out[p.name] = Number(raw);
    else out[p.name] = raw;
  }
  return out;
}

/** Builds a function that gives the formula context of one row. Column names are matched ignoring case. */
export function makeRowContext(
  columns: readonly { name: string; type: ColumnType }[],
  params?: FormulaParams,
): (row: Readonly<Record<string, Typed>>) => FormulaContext {
  const byName = new Map<string, Entry>();
  for (const c of columns) {
    const key = c.name.toUpperCase();
    if (!byName.has(key)) byName.set(key, { key: c.name, type: c.type });
  }
  const folded = params ? new Map(Object.entries(params).map(([k, v]) => [k.toUpperCase(), v] as const)) : null;

  return (row) => ({
    getColumn: (name) => {
      const entry = byName.get(name.toUpperCase());
      if (!entry) return undefined;
      const v = row[entry.key] ?? null;
      return entry.type === 'money' && typeof v === 'number' ? v / 100 : v;
    },
    getParam: folded ? (name) => folded.get(name.toUpperCase()) : undefined,
  });
}

