import { ArrowRightLeft, CircleAlert, CircleCheck, CircleDashed, FileSpreadsheet, Pencil, Play, X } from 'lucide-react';
import { useEffect } from 'react';
import { useGenerate, slotsFor } from '@/app/generateStore';
import { useHandoff } from '@/app/handoff';
import { useLibrary } from '@/app/libraryStore';
import { useAppStore } from '@/app/store';
import { EmptyState } from '@/components/EmptyState';
import { FileDrop } from '@/components/FileDrop';
import { NativeSelect } from '@/components/NativeSelect';
import { ProgressBar } from '@/components/ProgressBar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Recipe } from '@/recipe/schema';
import { NOT_USED, type SourceSlot } from './assignments';
import { ResultView } from './ResultView';

const CHOOSE = '__choose';

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3" aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="flex items-center gap-2 text-lg font-medium">
        <span className="flex size-7 items-center justify-center rounded-full bg-primary text-sm text-primary-foreground" aria-hidden>
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function SlotRow({ slot }: { slot: SourceSlot }) {
  const ok = slot.state === 'ok';
  const bad = slot.state === 'missing' || slot.state === 'conflict';
  const Icon = ok ? CircleCheck : bad ? CircleAlert : CircleDashed;
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Icon className={cn('mt-0.5 size-5 shrink-0', ok ? 'text-emerald-600' : bad ? 'text-destructive' : 'text-muted-foreground')} aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">
          {slot.label} {!slot.required && <span className="font-normal text-muted-foreground">(optional)</span>}
        </p>
        <p className={cn('break-words', ok ? 'text-muted-foreground' : bad ? 'text-destructive' : 'text-muted-foreground')}>
          {slot.state === 'ok' && slot.files[0]}
          {slot.state === 'missing' && 'File missing'}
          {slot.state === 'optional-missing' && 'Not added. It will be left out.'}
          {slot.state === 'conflict' && `${slot.files.length} files: keep only one (${slot.files.join(', ')})`}
        </p>
      </div>
    </li>
  );
}

function Picker() {
  const recipes = useLibrary((s) => s.recipes);
  const status = useLibrary((s) => s.status);
  const go = useAppStore((s) => s.go);
  if (status === 'loading') return <p className="text-sm text-muted-foreground" role="status">Loading…</p>;
  if (recipes.length === 0) {
    return <EmptyState icon={FileSpreadsheet} title="No recipes yet" description="A recipe tells the app how to make your report. Create one first." action={<Button onClick={() => go({ page: 'home' })}>Go to Home</Button>} />;
  }
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Generate a report</h1>
        <p className="mt-1 text-sm text-muted-foreground">Which report do you want to make?</p>
      </div>
      <ul className="space-y-3">
        {recipes.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => go({ page: 'generate', recipeId: r.id })} className="flex min-h-16 w-full items-center gap-3 rounded-lg border p-4 text-left hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
              <Play className="size-5 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.name}</span>
                <span className="block text-sm text-muted-foreground">
                  {r.sources.length} source{r.sources.length === 1 ? '' : 's'}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Generator({ recipe }: { recipe: Recipe }) {
  const go = useAppStore((s) => s.go);
  const g = useGenerate();
  useEffect(() => useGenerate.getState().begin(recipe), [recipe]);

  const slots = slotsFor(recipe, g.items, g.manual);
  const emptyParams = recipe.parameters.filter((p) => (g.params[p.name] ?? '').trim() === '');
  const canRun = slots.ready && g.items.length > 0 && emptyParams.length === 0 && !g.running && g.reading === null;

  const fileSource = (name: string): string => {
    const slot = slots.slots.find((s) => s.files.includes(name));
    if (slot) return slot.sourceId;
    return Object.hasOwn(g.manual, name) ? NOT_USED : CHOOSE;
  };

  function fixMapping(sourceId: string | undefined) {
    if (!sourceId) return;
    const fileName = slots.assignments.find((a) => a.sourceId === sourceId)?.fileName;
    const item = g.items.find((i) => i.file.name === fileName);
    if (item) useHandoff.getState().offer({ recipeId: recipe.id, sourceId, file: item.file });
    go({ page: 'recipe', recipeId: recipe.id });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{recipe.name}</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => go({ page: 'generate' })}>
            <ArrowRightLeft className="size-4" /> Choose another report
          </Button>
          <Button variant="ghost" size="sm" onClick={() => go({ page: 'recipe', recipeId: recipe.id })}>
            <Pencil className="size-4" /> Edit this recipe
          </Button>
        </div>
      </div>

      <Step n={1} title="Add this month's files">
        <FileDrop onFiles={(f) => void g.addFiles(f)} title="Choose the Excel files" hint="Add all of them at once. The app works out which is which." disabled={g.running} />
        {g.reading && <ProgressBar fraction={0.5} label={g.reading} />}

        {recipe.sources.length > 0 && (
          <Card>
            <CardContent>
              <ul className="divide-y" aria-label="Files needed">
                {slots.slots.map((s) => (
                  <SlotRow key={s.sourceId} slot={s} />
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {g.items.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Files you added</h3>
            <ul className="space-y-2">
              {g.items.map(({ file }) => {
                const current = fileSource(file.name);
                const unplaced = slots.unplaced.find((u) => u.fileName === file.name);
                return (
                  <li key={file.name} className={cn('space-y-2 rounded-lg border p-3', unplaced && 'border-amber-500/50 bg-amber-50 dark:bg-amber-950/30')}>
                    <div className="flex items-start gap-2">
                      <FileSpreadsheet className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 break-words text-sm font-medium">{file.name}</span>
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${file.name}`} onClick={() => g.removeFile(file.name)} disabled={g.running}>
                        <X className="size-4" />
                      </Button>
                    </div>
                    {unplaced && <p className="text-xs text-amber-900 dark:text-amber-200">{unplaced.reason}</p>}
                    <NativeSelect value={current} onChange={(e) => g.setManual(file.name, e.target.value)} aria-label={`What ${file.name} is`} disabled={g.running}>
                      {current === CHOOSE && <option value={CHOOSE}>Choose what this file is…</option>}
                      {recipe.sources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                      <option value={NOT_USED}>Do not use this file</option>
                    </NativeSelect>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Step>

      {recipe.parameters.length > 0 && (
        <Step n={2} title="Which report is it?">
          <div className="grid gap-3 sm:grid-cols-2">
            {recipe.parameters.map((p) => (
              <label key={p.name} className="space-y-1 text-sm">
                <span className="font-medium">{p.label || p.name}</span>
                <Input value={g.params[p.name] ?? ''} onChange={(e) => g.setParam(p.name, e.target.value)} disabled={g.running} aria-invalid={(g.params[p.name] ?? '').trim() === ''} />
              </label>
            ))}
          </div>
        </Step>
      )}

      <Step n={recipe.parameters.length > 0 ? 3 : 2} title="Make the report">
        <Button size="lg" className="w-full sm:w-auto" disabled={!canRun} onClick={() => void g.run(recipe)}>
          <Play className="size-5" /> Generate
        </Button>
        {!canRun && !g.running && (
          <p className="text-sm text-muted-foreground">
            {g.items.length === 0
              ? 'Add the files first.'
              : !slots.ready
                ? slots.unplaced.length > 0
                  ? 'Say what each highlighted file is (or leave it out).'
                  : 'Some files are missing or doubled. See the list above.'
                : emptyParams.length > 0
                  ? `Fill in: ${emptyParams.map((p) => p.label || p.name).join(', ')}.`
                  : ''}
          </p>
        )}
        {g.progress && <ProgressBar fraction={g.progress.fraction} label={g.progress.stage} detail={g.progress.detail} />}
        {g.error && (
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {g.error}
          </p>
        )}
      </Step>

      {g.result && g.resultFor && <ResultView result={g.result} info={g.resultFor} onFix={(c) => fixMapping(c.sourceId)} />}
    </div>
  );
}

export function GeneratePage() {
  const recipeId = useAppStore((s) => s.route.recipeId);
  const status = useLibrary((s) => s.status);
  const recipe = useLibrary((s) => s.recipes.find((r) => r.id === recipeId));
  const go = useAppStore((s) => s.go);

  if (!recipeId) return <Picker />;
  if (status === 'loading') return <p className="text-sm text-muted-foreground" role="status">Loading…</p>;
  if (!recipe) {
    return <EmptyState icon={FileSpreadsheet} title="That recipe was not found" description="It may have been deleted." action={<Button onClick={() => go({ page: 'generate' })}>Choose a report</Button>} />;
  }
  return <Generator recipe={recipe} />;
}
