// The saved library: recipes and dashboard templates, kept in IndexedDB (via idb-keyval) in the user's browser.
// Nothing else is ever stored: no uploaded data, no names, no amounts.

import { createStore, del, entries, get, set, type UseStore } from 'idb-keyval';
import { DashboardTemplateSchema, type DashboardTemplate } from '@/dashboard/schema';
import { newId } from '@/lib/id';
import type { ImportPlan } from './importExport';
import { RecipeSchema, type Recipe } from './schema';

/** The few storage operations the library needs. IndexedDB in the app; a Map in tests. */
export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  entries(): Promise<[string, unknown][]>;
}

export function idbStore(): KeyValueStore {
  const store: UseStore = createStore('report-builder', 'library');
  return {
    get: (key) => get(key, store),
    set: (key, value) => set(key, value, store),
    del: (key) => del(key, store),
    entries: async () => (await entries(store)).map(([k, v]) => [String(k), v] as [string, unknown]),
  };
}

export function memoryStore(): KeyValueStore {
  const map = new Map<string, unknown>();
  return {
    get: async (key) => map.get(key),
    set: async (key, value) => void map.set(key, structuredClone(value)),
    del: async (key) => void map.delete(key),
    entries: async () => [...map.entries()].map(([k, v]) => [k, structuredClone(v)] as [string, unknown]),
  };
}

const RECIPE = 'recipe:';
const DASHBOARD = 'dashboard:';

export type Library = ReturnType<typeof createLibrary>;

export function createLibrary(store: KeyValueStore) {
  /** Items that no longer pass validation (for example from an older version) are skipped, never deleted. */
  async function list<T>(prefix: string, parse: (v: unknown) => T | null): Promise<T[]> {
    const all = await store.entries();
    return all.filter(([k]) => k.startsWith(prefix)).flatMap(([, v]) => {
      const item = parse(v);
      return item ? [item] : [];
    });
  }
  const parseRecipe = (v: unknown) => {
    const r = RecipeSchema.safeParse(v);
    return r.success ? r.data : null;
  };
  const parseDashboard = (v: unknown) => {
    const r = DashboardTemplateSchema.safeParse(v);
    return r.success ? r.data : null;
  };
  const byRecent = <T extends { updatedAt?: string; name: string }>(a: T, b: T) =>
    (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.name.localeCompare(b.name);

  return {
    listRecipes: async () => (await list(RECIPE, parseRecipe)).sort(byRecent),
    getRecipe: async (id: string) => parseRecipe(await store.get(RECIPE + id)),
    /** Saves and stamps `updatedAt`. Returns what was stored. */
    saveRecipe: async (recipe: Recipe): Promise<Recipe> => {
      const saved = { ...recipe, updatedAt: new Date().toISOString() };
      await store.set(RECIPE + saved.id, saved);
      return saved;
    },
    deleteRecipe: (id: string) => store.del(RECIPE + id),
    /** A copy with a new id and "(copy)" in the name. */
    duplicateRecipe: async (id: string): Promise<Recipe | null> => {
      const source = parseRecipe(await store.get(RECIPE + id));
      if (!source) return null;
      const copy: Recipe = { ...structuredClone(source), id: newId(), name: `${source.name} (copy)`, updatedAt: new Date().toISOString() };
      await store.set(RECIPE + copy.id, copy);
      return copy;
    },

    listDashboards: async () => (await list(DASHBOARD, parseDashboard)).sort(byRecent),
    getDashboard: async (id: string) => parseDashboard(await store.get(DASHBOARD + id)),
    saveDashboard: async (dashboard: DashboardTemplate): Promise<DashboardTemplate> => {
      const saved = { ...dashboard, updatedAt: new Date().toISOString() };
      await store.set(DASHBOARD + saved.id, saved);
      return saved;
    },
    deleteDashboard: (id: string) => store.del(DASHBOARD + id),
    duplicateDashboard: async (id: string): Promise<DashboardTemplate | null> => {
      const source = parseDashboard(await store.get(DASHBOARD + id));
      if (!source) return null;
      const copy: DashboardTemplate = { ...structuredClone(source), id: newId(), name: `${source.name} (copy)`, updatedAt: new Date().toISOString() };
      await store.set(DASHBOARD + copy.id, copy);
      return copy;
    },

    /** Writes what a planned import says (keeps each item's own `updatedAt`). */
    applyImport: async (plan: Extract<ImportPlan, { ok: true }>): Promise<void> => {
      for (const r of plan.recipes) await store.set(RECIPE + r.id, r);
      for (const d of plan.dashboards) await store.set(DASHBOARD + d.id, d);
      for (const id of plan.removeRecipeIds) await store.del(RECIPE + id);
      for (const id of plan.removeDashboardIds) await store.del(DASHBOARD + id);
    },
  };
}
