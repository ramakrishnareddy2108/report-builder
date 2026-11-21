// "Fix mapping": hands a file from the Generate page to the recipe builder, in memory only,
// so the builder can open that source with the new file already loaded as its sample.

import { create } from 'zustand';

type Handoff = { recipeId: string; sourceId: string; file: File };

type HandoffState = {
  pending: Handoff | null;
  offer: (h: Handoff) => void;
  /** Takes the offer if it is for this recipe (and clears it). */
  take: (recipeId: string) => Handoff | null;
};

export const useHandoff = create<HandoffState>()((set, get) => ({
  pending: null,
  offer: (pending) => set({ pending }),
  take: (recipeId) => {
    const h = get().pending;
    if (!h || h.recipeId !== recipeId) return null;
    set({ pending: null });
    return h;
  },
}));
