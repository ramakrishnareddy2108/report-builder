// The Generate page's working state: uploaded files, chosen parameters and the last result.
// It lives in memory for the session, so going to "Fix mapping" and coming back does not lose the files.
// Nothing is saved to disk or IndexedDB.

import { create } from 'zustand';
import { assignFiles, type FileProbe } from '@/engine/assignFiles';
import { defaultReportMonth, monthLabel } from '@/core/dates';
import { buildSlots, defaultParamValue, type SlotsResult } from '@/pages/Generate/assignments';
import type { Recipe } from '@/recipe/schema';
import { generateInWorker, inspectFileInWorker } from '@/worker/client';
import type { TaskProgress } from '@/worker/protocol';
import type { GenerateTaskResult } from '@/worker/tasks/generate';
import { useSession } from './sessionStore';

type Item = { file: File; probe: FileProbe };

type GenerateState = {
  recipeId: string | null;
  items: Item[];
  /** file name → source id, or '' for "do not use this file". */
  manual: Record<string, string>;
  params: Record<string, string>;
  reading: string | null;
  running: boolean;
  progress: TaskProgress | null;
  result: GenerateTaskResult | null;
  /** What the result was made from, for the file name and for "Open in dashboard". */
  resultFor: { recipeId: string; recipeName: string; period: string } | null;
  error: string | null;
  /** Start for this recipe (keeps the files if it is the same recipe). */
  begin: (recipe: Recipe) => void;
  addFiles: (files: File[]) => Promise<void>;
  removeFile: (name: string) => void;
  setManual: (fileName: string, sourceId: string) => void;
  setParam: (name: string, value: string) => void;
  run: (recipe: Recipe) => Promise<void>;
};

export const slotsFor = (recipe: Recipe, items: readonly Item[], manual: Record<string, string>): SlotsResult =>
  buildSlots(recipe, items.map((i) => i.file.name), assignFiles(items.map((i) => i.probe), recipe), manual);

/** The month before today as "Oct-2026". */
export const previousMonthLabel = (): string => monthLabel(defaultReportMonth());

/** The value that names the period of the report: the "Month" parameter, else the first one. */
export function periodOf(recipe: Recipe, params: Record<string, string>): string {
  const p = recipe.parameters.find((x) => /^month$/i.test(x.name)) ?? recipe.parameters[0];
  return p ? (params[p.name] ?? '') : '';
}

export const useGenerate = create<GenerateState>()((set, get) => ({
  recipeId: null,
  items: [],
  manual: {},
  params: {},
  reading: null,
  running: false,
  progress: null,
  result: null,
  resultFor: null,
  error: null,

  begin: (recipe) => {
    const prev = get();
    const sameRecipe = prev.recipeId === recipe.id;
    const params = Object.fromEntries(recipe.parameters.map((p) => [p.name, (sameRecipe ? prev.params[p.name] : undefined) ?? defaultParamValue(p, previousMonthLabel())]));
    set(sameRecipe ? { params } : { recipeId: recipe.id, items: [], manual: {}, params, result: null, resultFor: null, error: null, progress: null });
  },

  addFiles: async (files) => {
    for (const [i, file] of files.entries()) {
      set({ reading: `Reading ${file.name} (${i + 1} of ${files.length})` });
      try {
        const r = await inspectFileInWorker({ file, headersOnly: true });
        const item: Item = { file, probe: { name: r.fileName, sheets: r.sheets } };
        set((s) => ({ items: [...s.items.filter((x) => x.file.name !== file.name), item], result: null, error: null }));
      } catch (err) {
        set({ error: `${file.name}: ${err instanceof Error ? err.message : 'could not be read.'}` });
      }
    }
    set({ reading: null });
  },

  removeFile: (name) =>
    set((s) => {
      const { [name]: _gone, ...manual } = s.manual;
      void _gone;
      return { items: s.items.filter((i) => i.file.name !== name), manual, result: null };
    }),

  setManual: (fileName, sourceId) => set((s) => ({ manual: { ...s.manual, [fileName]: sourceId }, result: null })),
  setParam: (name, value) => set((s) => ({ params: { ...s.params, [name]: value } })),

  run: async (recipe) => {
    const { items, manual, params } = get();
    const slots = slotsFor(recipe, items, manual);
    set({ running: true, error: null, result: null, progress: { stage: 'Starting', fraction: 0 } });
    try {
      const result = await generateInWorker(
        {
          recipe,
          params,
          ignoredFiles: slots.ignored,
          assignments: slots.assignments.map((a) => ({ sourceId: a.sourceId, file: (items.find((i) => i.file.name === a.fileName) as Item).file })),
        },
        (progress) => set({ progress }),
      );
      const period = periodOf(recipe, params);
      set({ result, resultFor: { recipeId: recipe.id, recipeName: recipe.name, period } });
      if (result.report && result.canDownload) {
        useSession.getState().setLastReport({ recipeId: recipe.id, recipeName: recipe.name, period, columns: result.report.columns, rows: result.report.rows });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Something went wrong while making the report.' });
    } finally {
      set({ running: false, progress: null });
    }
  },
}));
