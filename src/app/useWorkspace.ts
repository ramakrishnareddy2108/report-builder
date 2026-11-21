import { useMemo } from 'react';
import { openWorkspace, type Workspace } from '@/storage/workspace';
import { useAppStore } from './store';

const cache = new WeakMap<FileSystemDirectoryHandle, Workspace>();

/** The connected workspace (one shared instance per folder), or null when not connected. */
export function useWorkspace(): Workspace | null {
  const connection = useAppStore((s) => s.connection);
  const handle = connection.status === 'ready' ? connection.handle : null;
  return useMemo(() => {
    if (!handle) return null;
    let ws = cache.get(handle);
    if (!ws) {
      ws = openWorkspace(handle);
      cache.set(handle, ws);
    }
    return ws;
  }, [handle]);
}
