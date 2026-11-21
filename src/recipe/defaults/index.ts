// The starter recipes: DRR and Sponsor-wise. Their Excel templates are not shipped; the recipe asks for the template on first use.

import { RecipeSchema, type Recipe } from '../schema';
import drr from './drr.recipe.json';
import sponsorWise from './sponsorwise.recipe.json';

/** Fresh, validated copies of the starter recipes (so edits never change the originals). */
export function starterRecipes(): Recipe[] {
  const now = new Date().toISOString();
  return [drr, sponsorWise].map((r) => RecipeSchema.parse({ ...structuredClone(r), updatedAt: now }));
}

export const STARTER_IDS: readonly string[] = [drr.id, sponsorWise.id];
