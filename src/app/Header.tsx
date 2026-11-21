import { FolderOpen } from 'lucide-react';
import { useAppStore } from './store';

export function Header() {
  const connection = useAppStore((s) => s.connection);

  return (
    <header className="flex h-14 shrink-0 items-center justify-end border-b px-6">
      <div className="flex items-center gap-2 text-sm" title="Current workspace folder">
        <FolderOpen className="size-4 text-muted-foreground" />
        {connection.status === 'ready' ? (
          <span className="font-medium">{connection.handle.name}</span>
        ) : connection.status === 'needs-permission' ? (
          <span className="text-muted-foreground">
            {connection.handle.name} <span className="text-amber-600">(reconnect needed)</span>
          </span>
        ) : connection.status === 'loading' ? (
          <span className="text-muted-foreground">Loading…</span>
        ) : (
          <span className="text-muted-foreground">No workspace selected</span>
        )}
      </div>
    </header>
  );
}
