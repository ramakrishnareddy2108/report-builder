import { TriangleAlert } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Catches a crash inside a page and says so in plain words, instead of leaving a blank screen.
 * Saved files are never touched by a display error.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Page crashed', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-5 py-4" role="alert">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
        <div className="space-y-2 text-sm">
          <p className="font-medium text-destructive">Something went wrong while showing this page.</p>
          <p className="text-muted-foreground">
            Your saved settings and months are not affected. Try again; if it keeps happening, reload the page.
          </p>
          <p className="font-mono text-xs text-muted-foreground">{error.message}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Reload the page
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
