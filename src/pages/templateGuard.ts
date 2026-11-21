// A template stored in a recipe must be EMPTY. A filled report would put names and amounts into the recipe, and into the
// exported library file: against the rule that nothing about patients, doctors or amounts is saved.

import type { Recipe } from '@/recipe/schema';
import { inspectTemplateInWorker } from '@/worker/client';

/**
 * Looks at a template before it is stored. Returns a plain message when it must not be stored, else null.
 * A template that cannot be read is let through: the builder shows what is wrong with it.
 */
export async function templateProblem(templateBase64: string, recipe: Pick<Recipe, 'report'>): Promise<string | null> {
  const reportColumns = recipe.report.columns.map((c) => c.name).filter((n) => n.trim() !== '');
  const r = await inspectTemplateInWorker({
    templateBase64,
    output: { mode: 'template', templateName: '', templateBase64: '', headerRow: 'auto', keepTemplateFormulas: true, includeChecksSheet: false, includeCombinedSheet: false },
    reportColumns,
  });
  if (r.ok && r.filledRows > 0) {
    return `This template already has data in it (${r.filledRows} filled row${r.filledRows === 1 ? '' : 's'}). It would be saved inside the recipe, with the names and amounts. Please use the empty template.`;
  }
  return null;
}
