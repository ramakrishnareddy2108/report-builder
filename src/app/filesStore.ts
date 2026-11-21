// The Excel files loaded in this browser session. Only the File objects and a
// small preview live here; nothing is saved to disk, and the full rows are read
// again in the worker when a month is run.

import { create } from 'zustand';
import type { SourceId } from '@/core/types';
import type { HeaderDetection } from '@/excel/detectHeader';
import type { SourceIdentification } from '@/excel/identifySource';
import type { Row } from '@/excel/readWorkbook';
import type { TaskProgress } from '@/worker/protocol';
import type { SheetSummary } from '@/worker/tasks/readFile';

export type LoadedFile = {
  id: string;
  file: File;
  state: 'reading' | 'ready' | 'error';
  progress: TaskProgress | null;
  error: string | null;
  sha256: string | null;
  identification: SourceIdentification | null;
  /** The source this file is used as: identified automatically or chosen by the user. */
  sourceId: SourceId | null;
  sheets: SheetSummary[];
  sheet: string | null;
  header: HeaderDetection | null;
  /** First rows of the sheet (title rows included), Excel row 1 first. */
  previewRows: Row[];
  /** Formula cells saved without a value; they read as blank. */
  formulaCellsWithoutValue: number;
};

type FilesState = {
  files: LoadedFile[];
  add: (file: File) => string;
  patch: (id: string, patch: Partial<LoadedFile>) => void;
  remove: (id: string) => void;
  clear: () => void;
};

let counter = 0;

export const useFiles = create<FilesState>()((set) => ({
  files: [],
  add: (file) => {
    const id = `file-${++counter}`;
    const entry: LoadedFile = {
      id,
      file,
      state: 'reading',
      progress: null,
      error: null,
      sha256: null,
      identification: null,
      sourceId: null,
      sheets: [],
      sheet: null,
      header: null,
      previewRows: [],
      formulaCellsWithoutValue: 0,
    };
    set((s) => ({ files: [...s.files, entry] }));
    return id;
  },
  patch: (id, patch) => set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, ...patch } : f)) })),
  remove: (id) => set((s) => ({ files: s.files.filter((f) => f.id !== id) })),
  clear: () => set({ files: [] }),
}));

/** The file used for a source: the most recently added one assigned to it. */
export function fileForSource(files: readonly LoadedFile[], sourceId: SourceId): LoadedFile | null {
  for (let i = files.length - 1; i >= 0; i--) {
    const f = files[i];
    if (f && f.sourceId === sourceId && f.state === 'ready') return f;
  }
  return null;
}
