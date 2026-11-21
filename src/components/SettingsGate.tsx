import { Loader2, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSettings } from '@/app/settingsStore';

/** Shows children once the settings have loaded; otherwise a loading or plain-language error message. */
export function SettingsGate({ children }: { children: ReactNode }) {
  const status = useSettings((s) => s.status);
  const error = useSettings((s) => s.error);
  if (status === 'ready') return <>{children}</>;
  if (status === 'error') {
    return (
      <div className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm" role="alert">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div>
          <p className="font-medium text-destructive">A settings file could not be read.</p>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{error}</p>
          <p className="mt-2 text-muted-foreground">
            Nothing was changed. Fix or restore the file (for example from a backup), then reload this page.
          </p>
        </div>
      </div>
    );
  }
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Loading settings…
    </p>
  );
}
