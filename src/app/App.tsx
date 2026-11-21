import { useEffect } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PAGE_COMPONENTS } from '@/pages';
import { isFileSystemAccessSupported } from '@/storage/workspace';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { useSettings } from './settingsStore';
import { useAppStore } from './store';
import { UnsupportedBrowser } from './UnsupportedBrowser';
import { useWorkspace } from './useWorkspace';
import { restoreWorkspace } from './workspaceSession';

export function App() {
  const page = useAppStore((s) => s.page);
  const supported = isFileSystemAccessSupported();

  useEffect(() => {
    if (supported) void restoreWorkspace();
  }, [supported]);

  // Settings are read once per connected folder and shared by every page.
  const ws = useWorkspace();
  useEffect(() => {
    if (ws) void useSettings.getState().load(ws);
  }, [ws]);

  if (!supported) return <UnsupportedBrowser />;

  const Page = PAGE_COMPONENTS[page];

  return (
    <TooltipProvider>
      <div className="flex h-screen bg-background text-foreground">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />
          <main className="flex-1 overflow-auto p-6">
            <Page />
          </main>
        </div>
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
