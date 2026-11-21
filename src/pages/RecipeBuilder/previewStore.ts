// The live preview behind the Prepare and Report tabs: the sample files run through the recipe in the worker.
// A run is started a moment after the last edit, and an older run that finishes late is ignored.

import { useEffect } from 'react';
import { create } from 'zustand';
import type { Recipe } from '@/recipe/schema';
import { previewInWorker } from '@/worker/client';
import type { PreviewResult } from '@/worker/tasks/preview';
import { useBuilder } from './builderStore';

type PreviewState = {
  result: PreviewResult | null;
  stage: 'prepare' | 'report' | null;
  running: boolean;
  error: string | null;
};

export const usePreview = create<PreviewState>()(() => ({ result: null, stage: null, running: false, error: null }));

let runId = 0;

/** The parts of the recipe that change the preview (the stored template file does not). */
function signature(recipe: Recipe, samples: ReturnType<typeof useBuilder.getState>['samples'], stage: string): string {
  const output = recipe.output.mode === 'template' ? { ...recipe.output, templateBase64: '' } : recipe.output;
  const files = Object.entries(samples).map(([id, s]) => `${id}:${s.file.name}:${s.file.size}:${s.sheet}:${s.headerRow}`);
  return JSON.stringify({ recipe: { ...recipe, output, name: '', description: undefined, updatedAt: '' }, files, stage });
}

async function run(stage: 'prepare' | 'report'): Promise<void> {
  const { recipe, samples } = useBuilder.getState();
  if (!recipe) return;
  const assignments = recipe.sources.filter((s) => samples[s.id]).map((s) => ({ sourceId: s.id, file: (samples[s.id] as NonNullable<(typeof samples)[string]>).file }));
  const id = ++runId;
  if (assignments.length === 0) {
    usePreview.setState({ result: null, stage, running: false, error: null });
    return;
  }
  usePreview.setState({ running: true, error: null, stage });
  try {
    const params = Object.fromEntries(recipe.parameters.map((p) => [p.name, p.default ?? '']));
    const result = await previewInWorker({ recipe, params, assignments, stage });
    if (id === runId) usePreview.setState({ result, running: false });
  } catch (err) {
    if (id === runId) usePreview.setState({ running: false, error: err instanceof Error ? err.message : 'The preview could not be made.' });
  }
}

/** Keep the preview fresh while a tab is on screen. */
export function usePreviewAuto(stage: 'prepare' | 'report'): PreviewState {
  const recipe = useBuilder((s) => s.recipe);
  const samples = useBuilder((s) => s.samples);
  const state = usePreview();
  const key = recipe ? signature(recipe, samples, stage) : '';

  useEffect(() => {
    if (!key) return;
    const t = setTimeout(() => void run(stage), 500);
    return () => clearTimeout(t);
  }, [key, stage]);

  return state;
}
