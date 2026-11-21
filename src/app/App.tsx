import { Loader2 } from 'lucide-react';
import { Suspense, useEffect } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PAGE_COMPONENTS } from '@/pages';
import { BottomNav } from './BottomNav';
import { ErrorBoundary } from './ErrorBoundary';
import { Header } from './Header';
import { useLibrary } from './libraryStore';
import { Sidebar } from './Sidebar';
import { UpdateBanner } from './UpdateBanner';
import { listenToHash, useAppStore } from './store';

export function App() {
  const page = useAppStore((s) => s.route.page);
  useEffect(() => listenToHash(), []);
  useEffect(() => void useLibrary.getState().load(), []);

  const Page = PAGE_COMPONENTS[page];

  return (
    <TooltipProvider>
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to the page
      </a>
      <div className="flex h-dvh bg-background text-foreground">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <UpdateBanner />
          <Header />
          <main id="main" tabIndex={-1} className="flex-1 overflow-auto p-4 pb-24 outline-none md:p-6 md:pb-6">
            {/* A new key per page clears an error from the page before. */}
            <ErrorBoundary key={page}>
              <Suspense
                fallback={
                  <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Loading…
                  </p>
                }
              >
                <Page />
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      </div>
      <BottomNav />
      <Toaster />
    </TooltipProvider>
  );
}
