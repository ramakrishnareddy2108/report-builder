// Connecting the app to the workspace folder: restore on start, choose, reconnect.
// Thin glue between the browser storage helpers and the app store.

import {
  hasWorkspacePermission,
  loadWorkspaceHandle,
  pickWorkspaceFolder,
  requestWorkspacePermission,
  saveWorkspaceHandle,
} from '@/storage/workspace';
import { useAppStore, type WorkspaceConnection } from './store';

const setConnection = (c: WorkspaceConnection) => useAppStore.getState().setConnection(c);

/** On app start: reuse the saved folder if the browser still allows access. */
export async function restoreWorkspace(): Promise<void> {
  try {
    // If the browser's storage hangs, don't leave the page on "Loading…" forever.
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
    const handle = await Promise.race([loadWorkspaceHandle(), timeout]);
    if (!handle) return setConnection({ status: 'none' });
    const granted = await hasWorkspacePermission(handle);
    setConnection(granted ? { status: 'ready', handle } : { status: 'needs-permission', handle });
  } catch {
    setConnection({ status: 'none' });
  }
}

/** Show the folder picker. Returns false if the user cancelled. Throws on other errors. */
export async function chooseWorkspace(): Promise<boolean> {
  const handle = await pickWorkspaceFolder();
  if (!handle) return false;
  // Remembering the folder for next time is a convenience. If the browser refuses
  // (private window, blocked site data), still use the folder for this session.
  try {
    await saveWorkspaceHandle(handle);
  } catch (err) {
    console.warn('Could not remember the workspace folder for next time', err);
  }
  setConnection({ status: 'ready', handle });
  return true;
}

/** Ask the browser for access to the saved folder again. Call from a click. */
export async function reconnectWorkspace(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const granted = await requestWorkspacePermission(handle);
  if (granted) setConnection({ status: 'ready', handle });
  return granted;
}
