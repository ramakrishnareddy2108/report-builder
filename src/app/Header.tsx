import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePwa } from './pwa';

export function Header() {
  const canInstall = usePwa((s) => s.canInstall);
  const install = usePwa((s) => s.install);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4 md:px-6">
      <span className="text-base font-semibold md:hidden">Report Builder</span>
      <span className="hidden text-sm text-muted-foreground md:inline">Excel exports in, finished report out.</span>
      <div className="flex items-center gap-2">
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
