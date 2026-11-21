import { FolderOpen } from 'lucide-react';
import { useAppStore } from './store';

export function Header() {
  const workspace = useAppStore((s) => s.workspace);

  return (
    <header className="flex h-14 shrink-0 items-center justify-end border-b px-6">
      <div className="flex items-center gap-2 text-sm" title="Current workspace folder">
        <FolderOpen className="size-4 text-muted-foreground" />
        {workspace ? (
          <span className="font-medium">{workspace.name}</span>
        ) : (
          <span className="text-muted-foreground">No workspace selected</span>
        )}
      </div>
    </header>
  );
}
