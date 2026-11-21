// The recipe being edited and its sample files.
//
// The recipe is plain data and is saved to the library (IndexedDB) a moment after every valid change.
// Sample files stay in memory only: they are for previewing and checking, never saved.

import { toast } from 'sonner';
import { create } from 'zustand';
import { useLibrary } from '@/app/libraryStore';
import { describeIssues, RecipeSchema, type Recipe, type SourceDef } from '@/recipe/schema';
import { loadSample, type Sample } from './sample';

export type SaveState = 'idle' | 'saving' | 'saved' | 'invalid';

type BuilderState = {
  recipe: Recipe | null;
  samples: Record<string, Sample>;
  /** The tab on screen: sources, prepare, report, output or test. */
  tab: string;
  setTab: (tab: string) => void;
  saveState: SaveState;
  /** Why the recipe could not be saved yet (shown next to the name). */
  problem: string | null;
  open: (recipe: Recipe) => void;
  /** Change the recipe: `mutate` gets a copy to edit. */
  update: (mutate: (draft: Recipe) => void) => void;
  setSample: (sourceId: string, sample: Sample) => void;
  removeSample: (sourceId: string) => void;
  /** Re-read a source's sample with another sheet or header row. */
  reloadSample: (sourceId: string, opts: { sheet?: string; headerRow?: number | 'auto' }) => Promise<void>;
  /** Write the draft to the library now (also called after a pause in typing). */
  saveNow: () => Promise<void>;
  close: () => void;
};

let timer: ReturnType<typeof setTimeout> | null = null;

export const useBuilder = create<BuilderState>()((set, get) => ({
  recipe: null,
  samples: {},
  tab: 'sources',
  setTab: (tab) => set({ tab }),
  saveState: 'idle',
  problem: null,

  open: (recipe) => {
    if (timer) clearTimeout(timer);
    set({ recipe: structuredClone(recipe), samples: {}, tab: 'sources', saveState: 'saved', problem: null });
  },

  update: (mutate) => {
    const current = get().recipe;
    if (!current) return;
    const draft = structuredClone(current);
    mutate(draft);
    set({ recipe: draft, saveState: 'saving' });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void get().saveNow(), 700);
  },

  setSample: (sourceId, sample) => set((s) => ({ samples: { ...s.samples, [sourceId]: sample } })),
  removeSample: (sourceId) =>
    set((s) => {
      const { [sourceId]: _gone, ...rest } = s.samples;
      void _gone;
      return { samples: rest };
    }),

  reloadSample: async (sourceId, opts) => {
    const sample = get().samples[sourceId];
    if (!sample) return;
    try {
      const { sample: next } = await loadSample(sample.file, opts);
      get().setSample(sourceId, next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That file could not be read.');
    }
  },

  saveNow: async () => {
    if (timer) clearTimeout(timer);
    const recipe = get().recipe;
    if (!recipe) return;
    const parsed = RecipeSchema.safeParse(recipe);
    if (!parsed.success) {
      set({ saveState: 'invalid', problem: describeIssues(parsed.error, 2) });
      return;
    }
    try {
      await useLibrary.getState().saveRecipe(parsed.data);
      set({ saveState: 'saved', problem: null });
    } catch {
      set({ saveState: 'invalid', problem: 'Could not save in this browser.' });
    }
  },

  close: () => {
    if (timer) clearTimeout(timer);
    // Anything typed in the last moments is saved before leaving.
    if (get().saveState === 'saving') void get().saveNow();
    set({ recipe: null, samples: {}, saveState: 'idle', problem: null });
  },
}));

/** The source with this id, from the recipe being edited. */
export function sourceOf(recipe: Recipe, id: string): SourceDef | undefined {
  return recipe.sources.find((s) => s.id === id);
}
