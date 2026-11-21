import { ArrowLeft, Check, CircleAlert, FileSpreadsheet, Loader2, Play } from 'lucide-react';
import { useEffect } from 'react';
import { useLibrary } from '@/app/libraryStore';
import { useAppStore } from '@/app/store';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUnsavedWarning } from '@/lib/useUnsavedWarning';
import { useBuilder } from './builderStore';
import { ParametersEditor } from './ParametersEditor';
import { PrepareTab } from './PrepareTab';
import { ReportTab } from './ReportTab';
import { SourcesTab } from './SourcesTab';

const TABS = [
  { id: 'sources', label: '1 Sources' },
  { id: 'prepare', label: '2 Prepare' },
  { id: 'report', label: '3 Report' },
  { id: 'output', label: '4 Output' },
  { id: 'test', label: '5 Test & Save' },
] as const;

function SaveIndicator() {
  const saveState = useBuilder((s) => s.saveState);
  const problem = useBuilder((s) => s.problem);
  if (saveState === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Saving…
      </span>
    );
  }
  if (saveState === 'invalid') {
    return (
      <span className="flex items-center gap-1.5 text-sm text-destructive" role="alert" title={problem ?? ''}>
        <CircleAlert className="size-4 shrink-0" aria-hidden /> Not saved yet{problem ? `: ${problem}` : ''}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
      <Check className="size-4" aria-hidden /> Saved in this browser
    </span>
  );
}

export function RecipeBuilderPage() {
  const recipeId = useAppStore((s) => s.route.recipeId);
  const go = useAppStore((s) => s.go);
  const libraryStatus = useLibrary((s) => s.status);
  const saved = useLibrary((s) => s.recipes.find((r) => r.id === recipeId));
  const recipe = useBuilder((s) => s.recipe);
  const saveState = useBuilder((s) => s.saveState);
  const update = useBuilder((s) => s.update);

  // Open the recipe from the library once, when this page is entered or another recipe is chosen.
  useEffect(() => {
    if (!recipeId || libraryStatus !== 'ready') return;
    const current = useBuilder.getState().recipe;
    if (current?.id === recipeId) return;
    if (saved) useBuilder.getState().open(saved);
  }, [recipeId, libraryStatus, saved]);

  // Save what was typed in the last moments when leaving the page.
  useEffect(() => () => useBuilder.getState().close(), []);
  useUnsavedWarning(saveState === 'saving' || saveState === 'invalid');

  if (!recipeId) {
    return (
      <EmptyState icon={FileSpreadsheet} title="Open a recipe from Home" description="Choose New recipe or Edit on the Home page to start building." action={<Button onClick={() => go({ page: 'home' })}>Go to Home</Button>} />
    );
  }
  if (libraryStatus === 'loading') return <p className="text-sm text-muted-foreground" role="status">Loading…</p>;
  if (!recipe || recipe.id !== recipeId) {
    return libraryStatus === 'ready' && !saved ? (
      <EmptyState icon={FileSpreadsheet} title="That recipe was not found" description="It may have been deleted. Go back to Home to see your recipes." action={<Button onClick={() => go({ page: 'home' })}>Go to Home</Button>} />
    ) : (
      <p className="text-sm text-muted-foreground" role="status">Opening the recipe…</p>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => go({ page: 'home' })}>
          <ArrowLeft className="size-4" /> Home
        </Button>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            value={recipe.name}
            onChange={(e) => update((r) => void (r.name = e.target.value))}
            aria-label="Recipe name"
            placeholder="Name of this recipe"
            aria-invalid={recipe.name.trim() === ''}
            className="h-11 text-lg font-semibold md:h-10 md:text-xl"
          />
          <Button onClick={() => go({ page: 'generate', recipeId: recipe.id })} className="shrink-0" disabled={saveState === 'invalid'}>
            <Play className="size-4" /> Generate
          </Button>
        </div>
        <SaveIndicator />
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-semibold">Description and questions asked each time (like the month)</summary>
          <div className="mt-3 space-y-4">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Description (optional)</span>
              <Input value={recipe.description ?? ''} onChange={(e) => update((r) => void (r.description = e.target.value || undefined))} placeholder="What is this report for?" />
            </label>
            <ParametersEditor />
          </div>
        </details>
      </div>

      <Tabs defaultValue="sources" className="gap-4">
        <TabsList className="h-auto w-full justify-start overflow-x-auto" aria-label="Recipe steps">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="min-h-10 shrink-0 px-3">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="sources" className="pt-2">
          <SourcesTab />
        </TabsContent>
        <TabsContent value="prepare" className="pt-2">
          <PrepareTab />
        </TabsContent>
        <TabsContent value="report" className="pt-2">
          <ReportTab />
        </TabsContent>
        {TABS.slice(3).map((t) => (
          <TabsContent key={t.id} value={t.id} className="pt-2">
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">This step is coming next.</p>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
