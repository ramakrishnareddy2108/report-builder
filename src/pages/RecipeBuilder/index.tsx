import { ArrowLeft, ArrowRight, Calculator, Check, CircleAlert, FileSpreadsheet, LayoutTemplate, Loader2, Play, ShieldCheck, Wand2, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { checkRecipe } from '@/recipe/validate';
import { toast } from 'sonner';
import { useHandoff } from '@/app/handoff';
import { useLibrary } from '@/app/libraryStore';
import { useAppStore } from '@/app/store';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUnsavedWarning } from '@/lib/useUnsavedWarning';
import { useBuilder } from './builderStore';
import { ParametersEditor } from './ParametersEditor';
import { loadSample } from './sample';
import { PrepareTab } from './PrepareTab';
import { OutputTab } from './OutputTab';
import { ReportTab } from './ReportTab';
import { TestTab } from './TestTab';
import { SourcesTab } from './SourcesTab';

type StepId = 'sources' | 'prepare' | 'report' | 'output' | 'test';

/** The five steps, each with a plain-language subtitle and a short "what you do here". */
const STEPS: readonly { id: StepId; label: string; sub: string; icon: LucideIcon; intro: React.ReactNode }[] = [
  {
    id: 'sources',
    label: 'Sources',
    sub: 'Your Excel files',
    icon: FileSpreadsheet,
    intro: (
      <>
        Add last month’s exports as samples. For each file, tick the columns the report needs and give each a <b>common name</b>.
        For example, <code>ORGNAME</code> in one file and <code>ORGANIZATIONNAME</code> in another both become <b>Sponsor</b>, so
        all files line up like one ledger.
      </>
    ),
  },
  {
    id: 'prepare',
    label: 'Prepare',
    sub: 'Tidy names · optional',
    icon: Wand2,
    intro: (
      <>
        <b>Optional.</b> Merge different spellings of the same name (“DR. K.KRISHNA”, “k krishna”) so their figures add up, and
        fill gaps such as the doctor on a pharmacy bill. If the names already look right, skip to <b>Report</b>.
      </>
    ),
  },
  {
    id: 'report',
    label: 'Report',
    sub: 'Rows, totals, formulas',
    icon: Calculator,
    intro: (
      <>
        Decide what one line of the report is (for example one per doctor per month). Then add columns: a <b>Total</b> adds up a
        column from the files you tick, like Excel’s SUMIF. A <b>Formula</b> works across report columns, like
        Total Revenue = IP Revenue + OP Revenue + OP Pharmacy.
      </>
    ),
  },
  {
    id: 'output',
    label: 'Output',
    sub: 'Excel layout',
    icon: LayoutTemplate,
    intro: <>Choose a plain Excel sheet, or upload your own format. The app fills it in and keeps its formulas and styling.</>,
  },
  {
    id: 'test',
    label: 'Test & Save',
    sub: 'Try it on the samples',
    icon: ShieldCheck,
    intro: <>Run everything on the sample files and read the checks. Fix anything red. When nothing is left to fix, the recipe is ready for every month.</>,
  },
];

function StepIntro({ step }: { step: (typeof STEPS)[number] }) {
  return (
    <div className="flex gap-3 rounded-xl border border-primary/15 bg-accent/60 p-4 text-sm leading-relaxed">
      <step.icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
      <p className="[&_code]:rounded [&_code]:bg-background [&_code]:px-1 [&_code]:text-xs">{step.intro}</p>
    </div>
  );
}

function StepNav({ index, onGo }: { index: number; onGo: (id: StepId) => void }) {
  const prev = STEPS[index - 1];
  const next = STEPS[index + 1];
  return (
    <div className="mt-10 flex items-center justify-between gap-3 border-t pt-4">
      {prev ? (
        <Button variant="ghost" onClick={() => onGo(prev.id)}>
          <ArrowLeft className="size-4" /> {prev.label}
        </Button>
      ) : (
        <span />
      )}
      {next && (
        <Button onClick={() => onGo(next.id)}>
          Next: {next.label} <ArrowRight className="size-4" />
        </Button>
      )}
    </div>
  );
}

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
  const tab = useBuilder((s) => s.tab);
  const setTab = useBuilder((s) => s.setTab);

  // Open the recipe from the library once, when this page is entered or another recipe is chosen.
  useEffect(() => {
    if (!recipeId || libraryStatus !== 'ready') return;
    const current = useBuilder.getState().recipe;
    if (current?.id === recipeId) return;
    if (!saved) return;
    useBuilder.getState().open(saved);

    // "Fix mapping" from the Generate page: open that source with the new file loaded as its sample.
    const handoff = useHandoff.getState().take(saved.id);
    const source = handoff && saved.sources.find((s) => s.id === handoff.sourceId);
    if (handoff && source) {
      void loadSample(handoff.file, { sheet: source.sheet.name, headerRow: source.headerRow })
        .then(({ sample }) => {
          const b = useBuilder.getState();
          b.setSample(source.id, sample);
          b.setFocusSource(source.id);
          b.setTab('sources');
          toast.info(`${handoff.file.name} is loaded as the sample for ${source.label}. Pick the new columns below.`);
        })
        .catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'That file could not be read.'));
    }
  }, [recipeId, libraryStatus, saved]);

  // Save what was typed in the last moments when leaving the page.
  useEffect(() => () => useBuilder.getState().close(), []);
  useUnsavedWarning(saveState === 'saving' || saveState === 'invalid');

  // Problems per step, for the red dots on the stepper.
  const problems = useMemo(() => (recipe ? checkRecipe(recipe) : []), [recipe]);
  const stepIndex = Math.max(0, STEPS.findIndex((s) => s.id === tab));
  const goStep = (id: string) => {
    setTab(id);
    document.getElementById('main')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

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

      <Tabs value={tab} onValueChange={goStep} className="gap-5">
        <TabsList
          className="sticky -top-4 z-10 -mx-4 md:-top-6 grid h-auto! w-[calc(100%+2rem)] grid-cols-5 gap-1 rounded-none border-b bg-background/90! px-4 py-2 backdrop-blur md:mx-0 md:w-full md:rounded-xl md:border md:p-1.5"
          aria-label="Recipe steps"
        >
          {STEPS.map((s, i) => {
            const errors = problems.filter((p) => p.level === 'error' && p.tab === s.id).length;
            const done = i < stepIndex;
            return (
              <TabsTrigger
                key={s.id}
                value={s.id}
                className="h-auto min-h-12 flex-col items-center gap-1 rounded-lg px-1 py-2 whitespace-normal after:hidden data-active:bg-accent! data-active:text-foreground data-active:shadow-none! sm:flex-row sm:justify-start sm:gap-2.5 sm:px-2.5 sm:text-left"
              >
                <span
                  className={cn(
                    'relative flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                    i === stepIndex ? 'border-primary bg-primary text-primary-foreground' : done ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-background text-muted-foreground',
                  )}
                >
                  {done && errors === 0 ? <Check className="size-3.5" aria-hidden /> : i + 1}
                  {errors > 0 && (
                    <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-destructive ring-2 ring-background" aria-label={`${errors} to fix`} />
                  )}
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="block text-xs font-semibold sm:text-sm">{s.label}</span>
                  <span className="hidden truncate text-xs font-normal text-muted-foreground lg:block">{s.sub}</span>
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>
        {STEPS.map((s, i) => (
          <TabsContent key={s.id} value={s.id} className="rise-in space-y-6 pt-1">
            <StepIntro step={s} />
            {s.id === 'sources' && <SourcesTab />}
            {s.id === 'prepare' && <PrepareTab />}
            {s.id === 'report' && <ReportTab />}
            {s.id === 'output' && <OutputTab />}
            {s.id === 'test' && <TestTab />}
            <StepNav index={i} onGo={goStep} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
