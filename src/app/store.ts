import { create } from 'zustand';
import type { PageId } from './nav';

/** Where the app stands with the workspace folder. */
export type WorkspaceConnection =
  | { status: 'loading' }
  | { status: 'none' }
  /** A folder was used before, but the browser needs the user to allow access again. */
  | { status: 'needs-permission'; handle: FileSystemDirectoryHandle }
  | { status: 'ready'; handle: FileSystemDirectoryHandle };

type AppState = {
  page: PageId;
  connection: WorkspaceConnection;
  setPage: (page: PageId) => void;
  setConnection: (connection: WorkspaceConnection) => void;
};

export const useAppStore = create<AppState>()((set) => ({
  page: 'workspace',
  connection: { status: 'loading' },
  setPage: (page) => set({ page }),
  setConnection: (connection) => set({ connection }),
}));
