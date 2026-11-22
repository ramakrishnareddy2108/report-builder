// Problems in the recipe DEFINITION itself (as opposed to problems in a month's data): a formula that does not parse,
// a report column built on a column that does not exist, a template that was never added...
//
// The engine's own checks are reused on an empty table, so this can never disagree with what Generate would say.
// Errors stop "Save recipe"; warnings are shown. Data problems never block saving.

import { cleanup } from '@/engine/cleanup';
import { runLookups } from '@/engine/lookups';
import { buildReport } from '@/engine/report';
import { paramValues } from '@/engine/rowContext';
import type { CombinedTable } from '@/engine/types';
import { compileFormula, describeFormulaError } from '@/formula';
import { combinedColumns } from './columns';
import { describeIssues, RecipeSchema, type Recipe } from './schema';

export type RecipeTab = 'sources' | 'prepare' | 'report' | 'output';

export type RecipeProblem = { level: 'error' | 'warning'; message: string; tab: RecipeTab };

export function checkRecipe(recipe: Recipe): RecipeProblem[] {
  const out: RecipeProblem[] = [];
  const error = (tab: RecipeTab, message: string) => out.push({ level: 'error', tab, message });
  const warn = (tab: RecipeTab, message: string) => out.push({ level: 'warning', tab, message });

  const parsed = RecipeSchema.safeParse(recipe);
  if (!parsed.success) error('sources', `Some fields are empty or not valid (${describeIssues(parsed.error, 2)}).`);

  // sources
  if (recipe.sources.length === 0) error('sources', 'Add at least one source: choose sample files in 1 Sources.');
  const labels = new Set<string>();
  for (const s of recipe.sources) {
    const label = s.label.trim() || '(no name)';
    if (labels.has(label.toUpperCase())) error('sources', `Two sources are called “${label}”. Give them different names.`);
    labels.add(label.toUpperCase());
    if (s.columns.length === 0 && s.calculated.length === 0) error('sources', `${label}: no columns are picked. Tick the columns the report needs.`);
    const names = [...s.columns.map((c) => c.as), ...s.calculated.map((c) => c.as)].map((n) => n.trim().toUpperCase());
    if (new Set(names).size !== names.length) error('sources', `${label}: two columns have the same name. Give them different names.`);
    const formulas = [...(s.rowFilter ? [{ what: 'the row filter', text: s.rowFilter }] : []), ...s.calculated.map((c) => ({ what: `the formula for ${c.as || '(no name)'}`, text: c.formula }))];
    for (const f of formulas) {
      try {
        compileFormula(f.text);
      } catch (err) {
        error('sources', `${label}: ${f.what} is not valid: ${describeFormulaError(err)}`);
      }
    }
    if (s.required && s.match.requiredHeaders.length === 0 && !(s.match.namePattern ?? '').trim()) {
      warn('sources', `${label}: nothing tells the app which file this is (no columns picked and no file name). You will have to assign the file by hand each time.`);
    }
  }

  // The engine's checks on an empty table with this recipe's columns.
  const table: CombinedTable = { columns: combinedColumns(recipe), rows: [] };
  const params = paramValues(recipe.parameters, {});
  for (const i of cleanup(table, recipe.cleanup).issues) error('prepare', i.message);
  for (const i of runLookups(table, recipe.lookups, recipe, params).issues) error('prepare', i.message);

  // report
  if (recipe.report.columns.length === 0) error('report', 'The report has no columns yet. Add some in 3 Report.');
  const report = buildReport({ columns: combinedColumns(recipe), rows: [] }, recipe.report, params);
  for (const i of report.issues.filter((x) => x.level === 'error')) error('report', i.message.replace(/^Report: /, ''));

  // output
  if (recipe.output.mode === 'template') {
    if (recipe.output.templateBase64 === '') error('output', 'No template has been added. Upload the Excel template in 4 Output, or choose a plain sheet.');
    else if (recipe.output.templateBase64.length > 2_800_000) warn('output', 'The template file is large (over 2 MB). The recipe will be slow to save and share.');
  }
  for (const t of recipe.checks.tieOuts) {
    if (!recipe.sources.some((s) => s.id === t.source)) error('output', `The tie-out “${t.label}” uses a source that is not in this recipe.`);
    for (const id of t.alsoSources ?? []) if (!recipe.sources.some((s) => s.id === id)) error('output', `The tie-out “${t.label}” also adds up the source “${id}”, which is not in this recipe.`);
    if (!recipe.report.columns.some((c) => c.name.toUpperCase() === t.reportColumn.toUpperCase())) error('output', `The tie-out “${t.label}” compares with the report column “${t.reportColumn}”, which does not exist.`);
  }
  return out;
}

export const hasProblems = (problems: readonly RecipeProblem[]): boolean => problems.some((p) => p.level === 'error');
