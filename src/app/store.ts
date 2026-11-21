import { create } from 'zustand';
import type { PageId } from './nav';

type AppState = {
  page: PageId;
  workspace: FileSystemDirectoryHandle | null;
  setPage: (page: PageId) => void;
  setWorkspace: (handle: FileSystemDirectoryHandle | null) => void;
};

export const useAppStore = create<AppState>()((set) => ({
  page: 'workspace',
  workspace: null,
  setPage: (page) => set({ page }),
  setWorkspace: (workspace) => set({ workspace }),
}));
