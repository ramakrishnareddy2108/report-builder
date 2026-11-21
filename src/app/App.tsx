import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PAGE_COMPONENTS } from '@/pages';
import { isFileSystemAccessSupported } from '@/storage/workspace';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { useAppStore } from './store';
import { UnsupportedBrowser } from './UnsupportedBrowser';

export function App() {
  const page = useAppStore((s) => s.page);

  if (!isFileSystemAccessSupported()) return <UnsupportedBrowser />;

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
