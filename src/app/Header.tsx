import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrandMark } from './BrandMark';
import { usePwa } from './pwa';
import { UnsavedBadge } from './UnsavedBadge';

export function Header() {
  const canInstall = usePwa((s) => s.canInstall);
  const install = usePwa((s) => s.install);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-6">
      <span className="flex items-center gap-2 text-base font-semibold md:hidden">
        <BrandMark className="size-8" />
        Report Builder
      </span>
      <span className="hidden text-sm text-muted-foreground md:inline">HIS exports in. Checked, tied-out reports out.</span>
      <div className="flex items-center gap-2">
        <UnsavedBadge />
        {canInstall && (
          <Button size="sm" variant="outline" onClick={() => void install()}>
            <Download className="size-4" />
            Install app
          </Button>
        )}
      </div>
    </header>
  );
}
