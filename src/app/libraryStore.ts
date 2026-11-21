// The library in memory (recipes + dashboard templates), backed by IndexedDB.
// `unsaved` is true after any change until the library is exported to a file: the header shows a badge
// and reminds the user, because IndexedDB lives only in this browser.

import { toast } from 'sonner';
import { create } from 'zustand';
import type { DashboardTemplate } from '@/dashboard/schema';
import { downloadFile } from '@/lib/download';
import { buildLibraryFile, libraryFileName, type ImportPlan } from '@/recipe/importExport';
import { createLibrary, idbStore, type Library } from '@/recipe/library';
import type { Recipe } from '@/recipe/schema';

const UNSAVED_KEY = 'report-builder-unsaved-to-file';

function readFlag(): boolean {
  try {
    return localStorage.getItem(UNSAVED_KEY) === '1';
  } catch {
    return false;
  }
}
function writeFlag(on: boolean): void {
  try {
    if (on) localStorage.setItem(UNSAVED_KEY, '1');
    else localStorage.removeItem(UNSAVED_KEY);
  } catch {
    /* private window or blocked site data: the badge just won't survive a reload */
  }
}

type LibraryState = {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  recipes: Recipe[];
  dashboards: DashboardTemplate[];
  unsaved: boolean;
  load: () => Promise<void>;
  saveRecipe: (recipe: Recipe) => Promise<Recipe>;
  deleteRecipe: (id: string) => Promise<void>;
  duplicateRecipe: (id: string) => Promise<Recipe | null>;
  saveDashboard: (dashboard: DashboardTemplate) => Promise<DashboardTemplate>;
  deleteDashboard: (id: string) => Promise<void>;
  duplicateDashboard: (id: string) => Promise<DashboardTemplate | null>;
  importLibrary: (plan: Extract<ImportPlan, { ok: true }>) => Promise<void>;
  exportLibrary: () => void;
};

let library: Library | null = null;
const lib = (): Library => (library ??= createLibrary(idbStore()));

const STORAGE_PROBLEM =
  'This browser is not letting the app save recipes (private window or blocked site data?). Open the app in a normal window.';

export const useLibrary = create<LibraryState>()((set, get) => {
  async function refresh() {
    const [recipes, dashboards] = await Promise.all([lib().listRecipes(), lib().listDashboards()]);
    set({ recipes, dashboards, status: 'ready', error: null });
  }
  /** Run a change, reload the lists, and mark the library as not yet exported. */
  async function change<T>(work: () => Promise<T>): Promise<T> {
    try {
      const result = await work();
      await refresh();
      writeFlag(true);
      set({ unsaved: true });
      return result;
    } catch (err) {
      console.error(err);
      toast.error(STORAGE_PROBLEM);
      throw err;
    }
  }

  return {
    status: 'loading',
    error: null,
    recipes: [],
    dashboards: [],
    unsaved: readFlag(),
    load: async () => {
      try {
        await refresh();
      } catch (err) {
        console.error(err);
        set({ status: 'error', error: STORAGE_PROBLEM });
      }
    },
    saveRecipe: (recipe) => change(() => lib().saveRecipe(recipe)),
    deleteRecipe: (id) => change(() => lib().deleteRecipe(id)),
    duplicateRecipe: (id) => change(() => lib().duplicateRecipe(id)),
    saveDashboard: (dashboard) => change(() => lib().saveDashboard(dashboard)),
    deleteDashboard: (id) => change(() => lib().deleteDashboard(id)),
    duplicateDashboard: (id) => change(() => lib().duplicateDashboard(id)),
    importLibrary: (plan) => change(() => lib().applyImport(plan)),
    exportLibrary: () => {
      const { recipes, dashboards } = get();
      downloadFile(libraryFileName(), JSON.stringify(buildLibraryFile(recipes, dashboards), null, 2), 'application/json');
      writeFlag(false);
      set({ unsaved: false });
      toast.success('Library saved to a file. Keep it somewhere safe or share it with a colleague.');
    },
  };
});
