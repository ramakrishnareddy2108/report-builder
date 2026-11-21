// Workspace folder access via the File System Access API.
// Handle persistence (idb-keyval) and the folder layout come in a later task.

/** True when the browser supports picking a folder (Chrome / Edge on desktop). */
export function isFileSystemAccessSupported(win: object = globalThis): boolean {
  return typeof (win as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/**
 * Ask the user to choose the workspace folder.
 * Returns null if the user cancels the picker.
 */
export async function pickWorkspaceFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker({ id: 'drr-workspace', mode: 'readwrite' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}
