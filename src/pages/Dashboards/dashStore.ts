// The Dashboards page's working state: the loaded data (memory only), the filters and the template being edited.
// Only the template is ever saved (to the library). The data is never stored.

import { toast } from 'sonner';
import { create } from 'zustand';
import { useLibrary } from '@/app/libraryStore';
import { useSession } from '@/app/sessionStore';
import { dataFromReport, emptyData, type DashboardData } from '@/dashboard/data';
import type { DashboardTemplate, Tile } from '@/dashboard/schema';
import { tileColumns, type Filters } from '@/dashboard/tiles';
import { newId } from '@/lib/id';
import { readOutputsInWorker } from '@/worker/client';

type DashState = {
  data: DashboardData;
  loading: boolean;
  error: string | null;
  filters: Record<string, string[]>;
  draft: DashboardTemplate | null;
  dirty: boolean;
  /** Start editing a saved template (keeps the loaded data). */
  open: (template: DashboardTemplate) => void;
  update: (mutate: (draft: DashboardTemplate) => void) => void;
  addTile: (tile: Omit<Tile, 'id'>) => void;
  save: () => Promise<void>;
  setFilter: (column: string, values: string[]) => void;
  loadSession: () => void;
  loadFiles: (files: File[]) => Promise<void>;
  clearData: () => void;
};

/** Every column the template uses: tiles and filters. Saved as `requiredColumns`. */
export function columnsUsed(t: Pick<DashboardTemplate, 'tiles' | 'filters'>): string[] {
  return [...new Set([...t.filters.map((f) => f.column), ...t.tiles.flatMap(tileColumns)])];
}

export const filtersOf = (filters: Record<string, string[]>): Filters => filters;

export const useDash = create<DashState>()((set, get) => ({
  data: emptyData(),
  loading: false,
  error: null,
  filters: {},
  draft: null,
  dirty: false,

  open: (template) => set((s) => (s.draft?.id === template.id ? s : { draft: structuredClone(template), dirty: false, filters: {} })),

  update: (mutate) => {
    const current = get().draft;
    if (!current) return;
    const next = structuredClone(current);
    mutate(next);
    set({ draft: next, dirty: true });
  },

  addTile: (tile) => get().update((d) => void d.tiles.push({ ...tile, id: newId() })),

  save: async () => {
    const draft = get().draft;
    if (!draft) return;
    if (draft.name.trim() === '') {
      toast.error('Give the dashboard a name first.');
      return;
    }
    const saved = await useLibrary.getState().saveDashboard({ ...draft, requiredColumns: columnsUsed(draft) });
    set({ draft: saved, dirty: false });
    toast.success(`“${saved.name}” is saved.`);
  },

  setFilter: (column, values) => set((s) => ({ filters: { ...s.filters, [column]: values } })),

  loadSession: () => {
    const report = useSession.getState().lastReport;
    if (!report) {
      set({ error: 'No report has been generated in this session yet. Generate one first, or upload saved report files.' });
      return;
    }
    set({ data: dataFromReport(report), error: null, filters: {} });
  },

  loadFiles: async (files) => {
    set({ loading: true, error: null });
    try {
      const draft = get().draft;
      const recipe = draft?.recipeId ? useLibrary.getState().recipes.find((r) => r.id === draft.recipeId) : undefined;
      const data = await readOutputsInWorker({ files, recipe: recipe ? { report: recipe.report, output: recipe.output } : null });
      set({ data, filters: {} });
      if (data.rows.length === 0) set({ error: 'No rows were found in those files. See the notes below.' });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'The files could not be read.' });
    } finally {
      set({ loading: false });
    }
  },

  clearData: () => set({ data: emptyData(), filters: {}, error: null }),
}));
