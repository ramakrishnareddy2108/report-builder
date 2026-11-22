import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BrandMark } from './BrandMark';
import { PAGE_ICONS } from './icons';
import { NAV_PAGES } from './nav';
import { useAppStore } from './store';

/** Side menu on tablets and desktops (hidden on phones, where the bottom bar is used). */
export function Sidebar() {
  const page = useAppStore((s) => s.route.page);
  const go = useAppStore((s) => s.go);

  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-16 items-center gap-3 px-4">
        <BrandMark />
        <span className="leading-tight">
          <span className="block text-sm font-semibold tracking-tight">Report Builder</span>
          <span className="block text-xs text-sidebar-foreground/60">G2 Health Care · Finance</span>
        </span>
      </div>
      <nav className="flex flex-col gap-1 p-3" aria-label="Main">
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
                'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
                active
                  ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-sidebar-primary'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
              )}
            >
              <Icon className={cn('size-4', active && 'text-sidebar-primary')} />
              {label}
            </button>
          );
        })}
      </nav>
      <div className="mt-auto p-3">
        <p className="flex items-start gap-2 rounded-lg bg-sidebar-accent/60 p-3 text-xs leading-relaxed text-sidebar-foreground/75">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-sidebar-primary" aria-hidden />
          Your Excel files are read on this computer only. Nothing is uploaded.
        </p>
      </div>
    </aside>
  );
}
