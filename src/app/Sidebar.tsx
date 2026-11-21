import { cn } from '@/lib/utils';
import { PAGE_ICONS } from './icons';
import { NAV_PAGES } from './nav';
import { useAppStore } from './store';

/** Side menu on tablets and desktops (hidden on phones, where the bottom bar is used). */
export function Sidebar() {
  const page = useAppStore((s) => s.route.page);
  const go = useAppStore((s) => s.go);

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r bg-muted/30 md:flex">
      <div className="flex h-14 items-center border-b px-4">
        <span className="text-sm font-semibold">Report Builder</span>
      </div>
      <nav className="flex flex-col gap-1 p-2" aria-label="Main">
        {NAV_PAGES.map(({ id, label }) => {
          const Icon = PAGE_ICONS[id];
          const active = id === page || (id === 'home' && page === 'recipe');
          return (
            <button
              key={id}
              type="button"
              onClick={() => go({ page: id })}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors',
                active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
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
