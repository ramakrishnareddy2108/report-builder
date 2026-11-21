import { CircleAlert, CircleCheck, Download, Play, Save, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '@/app/store';
import { ChecksPanel } from '@/components/ChecksPanel';
import { ProgressBar } from '@/components/ProgressBar';
import { ReportGrid } from '@/components/ReportGrid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { downloadFile, XLSX_MIME } from '@/lib/download';
import { checkRecipe, hasProblems, type RecipeTab } from '@/recipe/validate';
import { generateInWorker } from '@/worker/client';
import type { TaskProgress } from '@/worker/protocol';
import type { GenerateTaskResult } from '@/worker/tasks/generate';
import { useBuilder } from './builderStore';

const TAB_LABEL: Record<RecipeTab, string> = { sources: '1 Sources', prepare: '2 Prepare', report: '3 Report', output: '4 Output' };

/** Tab 5: try the recipe on the sample files, read the checks, then save. */
export function TestTab() {
  const recipe = useBuilder((s) => s.recipe);
  const samples = useBuilder((s) => s.samples);
  const saveState = useBuilder((s) => s.saveState);
  const setTab = useBuilder((s) => s.setTab);
  const go = useAppStore((s) => s.go);
  const [values, setValues] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [result, setResult] = useState<GenerateTaskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const problems = useMemo(() => (recipe ? checkRecipe(recipe) : []), [recipe]);
  if (!recipe) return null;

  const valueOf = (name: string, def?: string) => values[name] ?? def ?? '';
  const withSample = recipe.sources.filter((s) => samples[s.id]);
  const withoutSample = recipe.sources.filter((s) => !samples[s.id]);
  const blocked = hasProblems(problems);

  async function run() {
    if (!recipe) return;
    setError(null);
    setResult(null);
    setProgress({ stage: 'Starting', fraction: 0 });
    try {
      const params = Object.fromEntries(recipe.parameters.map((p) => [p.name, valueOf(p.name, p.default)]));
      setResult(
        await generateInWorker(
          { recipe, params, assignments: withSample.map((s) => ({ sourceId: s.id, file: (samples[s.id] as NonNullable<(typeof samples)[string]>).file })) },
          setProgress,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setProgress(null);
    }
  }

  async function save() {
    await useBuilder.getState().saveNow();
    if (useBuilder.getState().saveState === 'saved') {
      toast.success(`“${recipe?.name}” is saved. Next: Generate.`);
      go({ page: 'home' });
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3" aria-labelledby="problems-h">
        <h2 id="problems-h" className="text-lg font-medium">
          Is the recipe complete?
        </h2>
        {problems.length === 0 ? (
          <p className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            <CircleCheck className="size-4 shrink-0" aria-hidden /> Nothing is missing.
          </p>
        ) : (
          <ul className="space-y-2">
            {problems.map((p, i) => (
              <li key={i} className={`flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm ${p.level === 'error' ? 'border-destructive/40 bg-destructive/5' : 'border-amber-500/40 bg-amber-50 dark:bg-amber-950/30'}`}>
                {p.level === 'error' ? <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden /> : <TriangleAlert className="size-4 shrink-0 text-amber-700" aria-hidden />}
                <span className="min-w-0 flex-1">{p.message}</span>
                <Button size="sm" variant="outline" onClick={() => setTab(p.tab)}>
                  Open {TAB_LABEL[p.tab]}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="test-h">
        <div>
          <h2 id="test-h" className="text-lg font-medium">
            Try it on your sample files
          </h2>
          <p className="text-sm text-muted-foreground">Runs the whole recipe, exactly as Generate will, and shows the checks. Nothing is saved.</p>
        </div>
        {recipe.parameters.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {recipe.parameters.map((p) => (
              <label key={p.name} className="space-y-1 text-sm">
                <span className="font-medium">{p.label || p.name}</span>
                <Input value={valueOf(p.name, p.default)} onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))} />
              </label>
            ))}
          </div>
        )}
        {withoutSample.length > 0 && (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            No sample file for: <b>{withoutSample.map((s) => s.label).join(', ')}</b>. {withoutSample.some((s) => s.required) ? 'A required source without a file stops the test. ' : ''}
            <button type="button" className="underline" onClick={() => setTab('sources')}>
              Add them in 1 Sources
            </button>
            .
          </p>
        )}
        <Button onClick={() => void run()} disabled={progress !== null || withSample.length === 0}>
          <Play className="size-4" /> Run test
        </Button>
        {progress && <ProgressBar fraction={progress.fraction} label={progress.stage} detail={progress.detail} />}
        {error && (
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </section>

      {result && (
        <section className="space-y-4" aria-labelledby="result-h">
          <h2 id="result-h" className="text-lg font-medium">
            Result
          </h2>
          <ChecksPanel checks={result.checks} onFix={() => setTab('sources')} />
          {result.report && result.report.columns.length > 0 && <ReportGrid columns={result.report.columns} rows={result.report.rows} totals={result.report.totals} />}
          <Button
            variant="outline"
            disabled={!result.workbookBytes || !result.canDownload}
            onClick={() => result.workbookBytes && downloadFile(`${recipe.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'recipe'}_test.xlsx`, result.workbookBytes as unknown as BlobPart, XLSX_MIME)}
          >
            <Download className="size-4" /> Download the test output
          </Button>
          {!result.canDownload && <p className="text-sm text-muted-foreground">The download is switched off while the checks above show problems to fix.</p>}
        </section>
      )}

      <section className="space-y-2 rounded-lg border p-4" aria-labelledby="save-h">
        <h2 id="save-h" className="text-lg font-medium">
          Save
        </h2>
        <p className="text-sm text-muted-foreground">Your changes are also saved automatically as you work. Saving here confirms the recipe is complete and takes you back to Home.</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void save()} disabled={blocked || saveState === 'invalid'}>
            <Save className="size-4" /> Save recipe
          </Button>
          {blocked && <span className="text-sm text-destructive">Fix the problems at the top first. Data problems never stop you from saving.</span>}
        </div>
      </section>
    </div>
  );
}
