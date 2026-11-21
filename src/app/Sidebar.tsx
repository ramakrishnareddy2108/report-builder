import { cn } from '@/lib/utils';
import { PAGE_ICONS } from './icons';
import { PAGES } from './nav';
import { useAppStore } from './store';

export function Sidebar() {
  const page = useAppStore((s) => s.page);
  const setPage = useAppStore((s) => s.setPage);

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/30">
      <div className="flex h-14 items-center border-b px-4">
        <span className="text-sm font-semibold">DRR Report Builder</span>
      </div>
      <nav className="flex flex-col gap-1 p-2" aria-label="Main">
        {PAGES.map(({ id, label }) => {
          const Icon = PAGE_ICONS[id];
          const active = id === page;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setPage(id)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
