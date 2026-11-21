import { cn } from '@/lib/utils';
import { PAGE_ICONS } from './icons';
import { NAV_PAGES } from './nav';
import { useAppStore } from './store';

/** Tab bar at the bottom of the screen on phones. Big touch targets, always in reach. */
export function BottomNav() {
  const page = useAppStore((s) => s.route.page);
  const go = useAppStore((s) => s.go);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
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
              'flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs',
              active ? 'font-semibold text-primary' : 'text-muted-foreground',
            )}
          >
            <Icon className="size-5" />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
