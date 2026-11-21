import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePwa } from './pwa';

/** Shown when a new version of the app has been downloaded in the background. */
export function UpdateBanner() {
  const updateReady = usePwa((s) => s.updateReady);
  const applyUpdate = usePwa((s) => s.applyUpdate);
  if (!updateReady) return null;

  return (
    <div role="status" className="flex items-center justify-between gap-3 border-b bg-primary px-4 py-2 text-sm text-primary-foreground">
      <span>A new version of the app is ready.</span>
      <Button size="sm" variant="secondary" onClick={applyUpdate}>
        <RefreshCw className="size-4" />
        Reload
      </Button>
    </div>
  );
}
