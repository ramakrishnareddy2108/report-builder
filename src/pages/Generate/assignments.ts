// Which uploaded file goes to which source, as the Generate page shows it: one slot per source.
// The automatic matching (engine/assignFiles) fills most slots; the user settles the rest. Nothing is guessed silently:
// a file that fits nothing, or two files for one source, is shown and the Generate button waits.

import type { AssignResult } from '@/engine/assignFiles';
import type { Recipe } from '@/recipe/schema';

export type SourceSlot = {
  sourceId: string;
  label: string;
  required: boolean;
  /** Files going to this source. Exactly one is fine; none or several need attention. */
  files: string[];
  state: 'ok' | 'missing' | 'optional-missing' | 'conflict';
};

export type SlotsResult = {
  slots: SourceSlot[];
  /** Files nobody has placed yet (and not marked "not used"). */
  unplaced: { fileName: string; candidates: string[]; reason: string }[];
  assignments: { sourceId: string; fileName: string }[];
  /** Every required source has one file, no source has two, and no file is left unplaced. */
  ready: boolean;
};

export const NOT_USED = '';

/**
 * `manual` maps a file name to a source id the user chose, or to NOT_USED ("do not use this file").
 * A manual choice beats the automatic one.
 */
export function buildSlots(recipe: Pick<Recipe, 'sources'>, fileNames: readonly string[], auto: AssignResult, manual: Readonly<Record<string, string>>): SlotsResult {
  const sourceOfFile = new Map<string, string | null>();
  for (const name of fileNames) {
    if (Object.hasOwn(manual, name)) sourceOfFile.set(name, manual[name] === NOT_USED ? null : (manual[name] as string));
    else sourceOfFile.set(name, auto.assignments.find((a) => a.fileName === name)?.sourceId ?? null);
  }

  const slots: SourceSlot[] = recipe.sources.map((s) => {
    const files = fileNames.filter((n) => sourceOfFile.get(n) === s.id);
    const state = files.length > 1 ? 'conflict' : files.length === 1 ? 'ok' : s.required ? 'missing' : 'optional-missing';
    return { sourceId: s.id, label: s.label, required: s.required, files, state };
  });

  const unplaced = fileNames
    .filter((n) => sourceOfFile.get(n) === null && manual[n] !== NOT_USED)
    .map((fileName) => {
      const amb = auto.ambiguous.find((a) => a.fileName === fileName);
      return { fileName, candidates: amb?.candidates ?? [], reason: amb?.reason ?? 'This file does not look like any source of the recipe. Choose which one it is, or leave it out.' };
    });

  const assignments = slots.filter((s) => s.files.length === 1).map((s) => ({ sourceId: s.sourceId, fileName: s.files[0] as string }));
  const ready = unplaced.length === 0 && slots.every((s) => s.state === 'ok' || s.state === 'optional-missing');
  return { slots, unplaced, assignments, ready };
}

/** "Oct-2026" for the month before today, for a parameter that asks for the month and has no default. */
export function defaultParamValue(param: { name: string; label: string; default?: string }, monthLabelOfPrevious: string): string {
  if (param.default !== undefined && param.default !== '') return param.default;
  return /month/i.test(param.name) || /month/i.test(param.label) ? monthLabelOfPrevious : '';
}

/** A file name for the finished report: "<Recipe name>_<Month>.xlsx" with characters Windows does not allow removed. */
export function reportFileName(recipeName: string, period: string): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const name = clean(recipeName) || 'Report';
  const when = clean(period);
  return `${name.replace(/ /g, '_')}${when ? `_${when.replace(/ /g, '_')}` : ''}.xlsx`;
}
