// Self-check: the template's own formulas (Total Revenue, Gross Profit) must
// give the same numbers as the tool computes. A mismatch means the template was
// changed (or the rules here are wrong), and the report must not be trusted.

import { MEASURES, measuresFor, type MeasureDef, type ReportKind } from '@/core/measures';
import { formatINR, toPaise } from '@/core/money';
import type { ReportRow } from '@/core/report';
import type { CheckResult } from '@/core/types';
import { compileFormula, describeFormulaError, recordContext, type Value } from '@/formula';
import { columnName } from './fillTemplate';
import { TemplateError, formulaOf, loadTemplate, type TemplateTable } from './templates';

export type FormulaMismatch = {
  /** Excel row the report row would be written to. */
  row: number;
  name: string;
  column: string;
  templatePaise: number;
  reportPaise: number;
};

export type FormulaVerification = {
  mismatches: FormulaMismatch[];
  /** Formulas that could not be checked (for example they refer to another row). */
  unreadable: string[];
};

const CELL_REF = /\$?([A-Z]{1,3})\$?(\d+)/g;

const headerOf = (kind: ReportKind, m: MeasureDef): string => (kind === 'drr' ? m.drrHeader : (m.sponsorHeader as string));

/** Evaluate the template's calc formulas for every report row and compare with the report's own numbers. */
export function verifyCalcFormulas(table: TemplateTable, kind: ReportKind, rows: readonly ReportRow[]): FormulaVerification {
  const result: FormulaVerification = { mismatches: [], unreadable: [] };
  const measures = measuresFor(kind);
  const letterOf = (m: MeasureDef) => columnName(table.columns.get(headerOf(kind, m)) as number);

  // One compiled formula per calc column, taken from the first data row.
  const compiled = measures
    .filter((m) => m.kind === 'calc')
    .flatMap((m) => {
      const header = headerOf(kind, m);
      const cell = table.sheet.getRow(table.firstDataRow).getCell(table.columns.get(header) as number);
      const text = formulaOf(cell);
      if (!text) return [];
      const refs = [...text.matchAll(CELL_REF)];
      if (refs.some((r) => Number(r[2]) !== table.firstDataRow)) {
        result.unreadable.push(`${header}: the formula ${text} refers to another row, so it cannot be checked.`);
        return [];
      }
      try {
        return [{ m, header, formula: compileFormula(text.replace(CELL_REF, (_all, letter: string) => `[${letter}]`)) }];
      } catch (err) {
        result.unreadable.push(`${header}: the formula ${text} cannot be read (${describeFormulaError(err)}).`);
        return [];
      }
    });

  rows.forEach((row, i) => {
    const values: Record<string, Value> = {};
    for (const m of measures) if (m.kind !== 'calc') values[letterOf(m)] = m.kind === 'count' ? row.values[m.code] : row.values[m.code] / 100;
    for (const { m, header, formula } of compiled) {
      let paise: number | null = null;
      try {
        const v = formula.evaluate(recordContext(values));
        paise = typeof v === 'number' ? toPaise(v) : null;
      } catch (err) {
        result.unreadable.push(`${header}: ${describeFormulaError(err)}`);
        return;
      }
      if (paise === null) {
        result.unreadable.push(`${header}: the formula did not give a number.`);
        return;
      }
      values[letterOf(m)] = paise / 100; // later formulas may build on this one (Gross Profit uses Total Revenue)
      if (paise !== row.values[m.code]) {
        result.mismatches.push({ row: table.firstDataRow + i, name: row.name, column: header, templatePaise: paise, reportPaise: row.values[m.code] });
      }
    }
  });
  result.unreadable = [...new Set(result.unreadable)];
  return result;
}

const TITLES: Record<ReportKind, { id: string; title: string; label: string }> = {
  drr: { id: 'template-drr', title: 'DRR template matches the report', label: 'DRR' },
  sponsor: { id: 'template-sponsor', title: 'Sponsor-wise template matches the report', label: 'Sponsor-wise' },
};

/** The self-check as a Check: Fail on a mismatch or a template that does not fit, Warning when there is no template. */
export async function checkTemplate(bytes: ArrayBuffer | Uint8Array | null, kind: ReportKind, rows: readonly ReportRow[]): Promise<CheckResult> {
  const { id, title, label } = TITLES[kind];
  const make = (level: CheckResult['level'], message: string, details?: string[]): CheckResult => ({ id, level, title, message, examples: [], ...(details ? { details } : {}) });

  if (bytes === null) {
    return make('Warning', `The ${label} template is not in the workspace, so no Excel report can be made yet. Upload it on the Settings page.`);
  }
  try {
    const table = await loadTemplate(bytes, kind);
    if (table.missing.length > 0) {
      return make('Fail', `The ${label} template has no column for ${table.missing.join(', ')}. Use the original template.`);
    }
    const check = verifyCalcFormulas(table, kind, rows);
    if (check.unreadable.length > 0) return make('Fail', `The ${label} template's formulas could not be checked.`, check.unreadable);
    if (check.mismatches.length > 0) {
      return make(
        'Fail',
        `The ${label} template's formulas give different numbers from the report for ${check.mismatches.length} value${check.mismatches.length === 1 ? '' : 's'}. The template may have been changed.`,
        check.mismatches
          .slice(0, 10)
          .map((m) => `Row ${m.row}, ${m.name}, ${m.column}: the template gives ${formatINR(m.templatePaise)}, the report has ${formatINR(m.reportPaise)}`),
      );
    }
    const names = MEASURES.filter((m) => m.kind === 'calc' && measuresFor(kind).includes(m)).map((m) => headerOf(kind, m));
    return make('Pass', `The ${label} template's formulas (${names.join(', ')}) give exactly the same numbers as the report.`);
  } catch (err) {
    if (err instanceof TemplateError) return make('Fail', `${err.message}`);
    throw err;
  }
}
