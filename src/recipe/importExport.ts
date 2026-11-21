// Export / import of the library (recipes + dashboard templates) as one JSON file.
// Pure functions: building the file, reading it back, and planning what an import would change.

import { z } from 'zod';
import { DashboardTemplateSchema, type DashboardTemplate } from '@/dashboard/schema';
import { RecipeSchema, describeIssues, type Recipe } from './schema';

export type LibraryFile = {
  schemaVersion: 1;
  exportedAt: string;
  recipes: Recipe[];
  dashboards: DashboardTemplate[];
};

const pad = (n: number) => String(n).padStart(2, '0');

/** report-library-YYYYMMDD.json (local date). */
export function libraryFileName(now: Date = new Date()): string {
  return `report-library-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`;
}

export function buildLibraryFile(recipes: readonly Recipe[], dashboards: readonly DashboardTemplate[], now: Date = new Date()): LibraryFile {
  return { schemaVersion: 1, exportedAt: now.toISOString(), recipes: [...recipes], dashboards: [...dashboards] };
}

export type ImportMode = 'merge' | 'replace';

export type ImportItem = {
  kind: 'recipe' | 'dashboard';
  /** The id inside the file, when it could be read. */
  id: string | null;
  name: string;
  /** new = not in the library yet; overwrite = same id already there; invalid = skipped. */
  status: 'new' | 'overwrite' | 'invalid';
  /** Why an invalid item was skipped. */
  error?: string;
};

export type ImportPlan =
  | { ok: false; message: string }
  | {
      ok: true;
      mode: ImportMode;
      items: ImportItem[];
      /** What will be written. */
      recipes: Recipe[];
      dashboards: DashboardTemplate[];
      /** Replace mode only: ids in the library that are not in the file and will be removed. */
      removeRecipeIds: string[];
      removeDashboardIds: string[];
      counts: { new: number; overwrite: number; invalid: number; removed: number };
    };

type Existing = { recipes: readonly { id: string }[]; dashboards: readonly { id: string }[] };

const FileShape = z.object({
  schemaVersion: z.literal(1, { error: 'This does not look like a Report Builder library file (schemaVersion 1 expected).' }),
  recipes: z.array(z.unknown()).default([]),
  dashboards: z.array(z.unknown()).default([]),
});

/** Name and id of an item even when it is invalid, so the summary can say which one failed. */
function peek(raw: unknown): { id: string | null; name: string } {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    id: typeof o.id === 'string' && o.id !== '' ? o.id : null,
    name: typeof o.name === 'string' && o.name.trim() !== '' ? o.name : '(no name)',
  };
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, message: 'That file is not valid JSON. Choose a library file saved with "Export library".' };
  }
}

/** Plan an import from the text of a library file. Nothing is written here. */
export function planImport(text: string, existing: Existing, mode: ImportMode = 'merge'): ImportPlan {
  const json = parseJson(text);
  if (!json.ok) return json;
  const shape = FileShape.safeParse(json.value);
  if (!shape.success) return { ok: false, message: describeIssues(shape.error, 2) };

  const haveRecipes = new Set(existing.recipes.map((r) => r.id));
  const haveDashboards = new Set(existing.dashboards.map((d) => d.id));
  const items: ImportItem[] = [];
  const recipes: Recipe[] = [];
  const dashboards: DashboardTemplate[] = [];

  for (const raw of shape.data.recipes) {
    const parsed = RecipeSchema.safeParse(raw);
    if (parsed.success) {
      recipes.push(parsed.data);
      items.push({ kind: 'recipe', id: parsed.data.id, name: parsed.data.name, status: haveRecipes.has(parsed.data.id) ? 'overwrite' : 'new' });
    } else {
      items.push({ kind: 'recipe', ...peek(raw), status: 'invalid', error: describeIssues(parsed.error, 3) });
    }
  }
  for (const raw of shape.data.dashboards) {
    const parsed = DashboardTemplateSchema.safeParse(raw);
    if (parsed.success) {
      dashboards.push(parsed.data);
      items.push({ kind: 'dashboard', id: parsed.data.id, name: parsed.data.name, status: haveDashboards.has(parsed.data.id) ? 'overwrite' : 'new' });
    } else {
      items.push({ kind: 'dashboard', ...peek(raw), status: 'invalid', error: describeIssues(parsed.error, 3) });
    }
  }

  // A file with nothing usable must never wipe the library in Replace mode.
  if (recipes.length + dashboards.length === 0) {
    const bad = items.length;
    return { ok: false, message: bad > 0 ? `None of the ${bad} items in this file could be read.` : 'This file has no recipes or dashboards in it.' };
  }

  const keepRecipes = new Set(recipes.map((r) => r.id));
  const keepDashboards = new Set(dashboards.map((d) => d.id));
  const removeRecipeIds = mode === 'replace' ? existing.recipes.map((r) => r.id).filter((id) => !keepRecipes.has(id)) : [];
  const removeDashboardIds = mode === 'replace' ? existing.dashboards.map((d) => d.id).filter((id) => !keepDashboards.has(id)) : [];

  return {
    ok: true,
    mode,
    items,
    recipes,
    dashboards,
    removeRecipeIds,
    removeDashboardIds,
    counts: {
      new: items.filter((i) => i.status === 'new').length,
      overwrite: items.filter((i) => i.status === 'overwrite').length,
      invalid: items.filter((i) => i.status === 'invalid').length,
      removed: removeRecipeIds.length + removeDashboardIds.length,
    },
  };
}
