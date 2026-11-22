import {
  ArrowRight,
  BookOpen,
  CircleCheck,
  CircleDashed,
  Copy,
  Download,
  EllipsisVertical,
  FileSpreadsheet,
  FileUp,
  LayoutDashboard,
  ListChecks,
  Lock,
  Pencil,
  Play,
  Plus,
  Scale,
  Sparkles,
  Trash2,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useLibrary } from '@/app/libraryStore';
import { useAppStore } from '@/app/store';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { blankRecipe } from '@/recipe/blank';
import { STARTER_IDS } from '@/recipe/defaults';
import { checkRecipe, hasProblems } from '@/recipe/validate';
import { ImportDialog } from './ImportDialog';

const formatDate = (iso: string | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/** "Good morning" etc., by the clock of this computer. */
function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** The month being closed: last month, e.g. "October 2026" on 22 Nov 2026. */
function closingMonth(now = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

type Doomed = { kind: 'recipe' | 'dashboard'; id: string; name: string };

function MoreMenu({ title, onDuplicate, onDelete }: { title: string; onDuplicate: () => void; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`More actions for ${title}`}>
          <EllipsisVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onDuplicate}>
          <Copy className="size-4" /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDelete} className="text-destructive">
          <Trash2 className="size-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const TRUST: { icon: LucideIcon; text: string }[] = [
  { icon: Lock, text: 'Files never leave this computer' },
  { icon: Scale, text: 'Every source total tied out' },
  { icon: ListChecks, text: 'Nothing dropped without a reason' },
];

const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: FileUp, title: 'Add the month’s exports', text: 'Drop all the HIS Excel files at once. The app recognises which is which.' },
  { icon: ListChecks, title: 'Review the checks', text: 'Red must be fixed, amber is worth a look. Every number shows its rows and file.' },
  { icon: Download, title: 'Download the report', text: 'Your own Excel template, filled in and ready to send.' },
];

export function HomePage() {
  const go = useAppStore((s) => s.go);
  const { status, error, recipes, dashboards } = useLibrary();
  const lib = useLibrary.getState;
  const fileInput = useRef<HTMLInputElement>(null);
  const [doomed, setDoomed] = useState<Doomed | null>(null);
  const [importText, setImportText] = useState<{ text: string; name: string } | null>(null);

  async function newRecipe() {
    const saved = await lib().saveRecipe(blankRecipe());
    go({ page: 'recipe', recipeId: saved.id });
  }

  const missingStarters = STARTER_IDS.some((id) => !recipes.some((r) => r.id === id));

  async function addStarters() {
    const n = await lib().addStarters();
    if (n > 0) toast.success(`Added ${n} starter recipe${n === 1 ? '' : 's'}. Press Generate and add its Excel template to begin.`);
  }

  async function duplicate(kind: Doomed['kind'], id: string) {
    const copy = kind === 'recipe' ? await lib().duplicateRecipe(id) : await lib().duplicateDashboard(id);
    if (copy) toast.success(`Created “${copy.name}”.`);
  }

  async function confirmDelete() {
    if (!doomed) return;
    if (doomed.kind === 'recipe') await lib().deleteRecipe(doomed.id);
    else await lib().deleteDashboard(doomed.id);
    toast.success(`Deleted “${doomed.name}”.`);
    setDoomed(null);
  }

  async function pickLibraryFile(file: File | undefined) {
    if (!file) return;
    try {
      setImportText({ text: await file.text(), name: file.name });
    } catch {
      toast.error('That file could not be opened.');
    }
  }

  if (status === 'loading') return <p className="text-sm text-muted-foreground" role="status">Loading your reports…</p>;
  if (status === 'error') {
    return (
      <p role="alert" className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </p>
    );
  }

  const withState = recipes.map((r) => ({ recipe: r, ready: !hasProblems(checkRecipe(r)) }));
  const readyCount = withState.filter((r) => r.ready).length;

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      {/* Hero */}
      <section className="rise-in relative overflow-hidden rounded-2xl bg-hero p-6 text-white shadow-lg sm:p-10" aria-labelledby="hero-h">
        <div className="pointer-events-none absolute -right-10 -bottom-16 hidden opacity-20 sm:block" aria-hidden>
          <svg width="320" height="220" viewBox="0 0 320 220" fill="none">
            <rect x="20" y="120" width="44" height="100" rx="8" fill="white" />
            <rect x="84" y="80" width="44" height="140" rx="8" fill="white" />
            <rect x="148" y="100" width="44" height="120" rx="8" fill="white" />
            <rect x="212" y="40" width="44" height="180" rx="8" fill="white" />
            <path d="M20 100 L106 60 L170 80 L250 20" stroke="white" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="relative max-w-2xl space-y-5">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium tracking-wide ring-1 ring-white/20">
            <span className="size-1.5 rounded-full bg-amber-300" aria-hidden />
            Month-end close · {closingMonth()}
          </p>
          <div className="space-y-2">
            <h1 id="hero-h" className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {greeting()}. Let’s close the month.
            </h1>
            <p className="max-w-xl text-base text-white/85 text-pretty">
              Drop in the HIS exports and get the DRR and Sponsor-wise reports, totalled, tied out and ready to send.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {recipes.length === 0 ? (
              <Button size="lg" className="h-11 bg-white px-5 text-base text-teal-900 hover:bg-white/90 md:h-11" onClick={() => void addStarters()}>
                <Sparkles className="size-4" />
                Add starter recipes: DRR, Sponsor-wise
              </Button>
            ) : (
              <Button size="lg" className="h-11 bg-white px-5 text-base text-teal-900 hover:bg-white/90 md:h-11" onClick={() => go({ page: 'generate' })}>
                <Play className="size-4" />
                Make this month’s report
                <ArrowRight className="size-4" />
              </Button>
            )}
            <Button size="lg" variant="ghost" className="h-11 px-4 text-white hover:bg-white/15 hover:text-white md:h-11" onClick={() => go({ page: 'help' })}>
              <BookOpen className="size-4" />
              How it works
            </Button>
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-sm text-white/85">
            {TRUST.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-1.5">
                <Icon className="size-4 text-amber-200" aria-hidden />
                {text}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* How a month works */}
      <section aria-labelledby="steps-h" className="rise-in space-y-3 [animation-delay:80ms]">
        <h2 id="steps-h" className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Every month, in three steps
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="flex gap-3 rounded-xl border bg-card p-4 shadow-xs">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="space-y-0.5">
                <span className="block text-sm font-semibold">
                  <span className="text-primary">{i + 1}.</span> {title}
                </span>
                <span className="block text-sm text-muted-foreground">{text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* Reports */}
      <section aria-labelledby="recipes-h" className="rise-in space-y-4 [animation-delay:140ms]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="recipes-h" className="text-xl font-semibold tracking-tight">
              Your reports
            </h2>
            <p className="text-sm text-muted-foreground">
              {recipes.length === 0
                ? 'Each report has a recipe: the one-time setup that says how to build it.'
                : `${readyCount} of ${recipes.length} ready to generate.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {missingStarters && recipes.length > 0 && (
              <Button variant="outline" onClick={() => void addStarters()}>
                <Sparkles className="size-4" />
                Add starter recipes
              </Button>
            )}
            <Button variant={recipes.length === 0 ? 'outline' : 'default'} onClick={() => void newRecipe()}>
              <Plus className="size-4" />
              New report
            </Button>
          </div>
        </div>

        {recipes.length === 0 ? (
          <EmptyState
            icon={FileSpreadsheet}
            title="No reports set up yet"
            description="Start with the ready-made DRR and Sponsor-wise recipes, which already follow the rules finance confirmed. Or build your own from scratch."
            action={
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={() => void addStarters()}>
                  <Sparkles className="size-4" />
                  Add the starter recipes
                </Button>
                <Button variant="outline" onClick={() => void newRecipe()}>
                  <Plus className="size-4" />
                  Start from scratch
                </Button>
              </div>
            }
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {withState.map(({ recipe: r, ready }) => (
              <li key={r.id} className="group flex flex-col rounded-xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-md">
                <div className="flex items-start gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
                    <FileSpreadsheet className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold leading-snug">{r.name}</h3>
                    {r.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{r.description}</p>}
                  </div>
                  <MoreMenu title={r.name} onDuplicate={() => void duplicate('recipe', r.id)} onDelete={() => setDoomed({ kind: 'recipe', id: r.id, name: r.name })} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium',
                      ready ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
                    )}
                  >
                    {ready ? <CircleCheck className="size-3.5" aria-hidden /> : <CircleDashed className="size-3.5" aria-hidden />}
                    {ready ? 'Ready' : 'Needs setup'}
                  </span>
                  <span className="text-muted-foreground">
                    {r.sources.length} Excel file{r.sources.length === 1 ? '' : 's'} · updated {formatDate(r.updatedAt)}
                  </span>
                </div>
                <div className="mt-4 flex gap-2 border-t pt-3">
                  {ready ? (
                    <>
                      <Button className="flex-1" onClick={() => go({ page: 'generate', recipeId: r.id })}>
                        <Play className="size-4" /> Generate
                      </Button>
                      <Button variant="ghost" onClick={() => go({ page: 'recipe', recipeId: r.id })}>
                        <Pencil className="size-4" /> Edit setup
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button className="flex-1" onClick={() => go({ page: 'recipe', recipeId: r.id })}>
                        <Pencil className="size-4" /> Finish setup
                      </Button>
                      <Button variant="ghost" onClick={() => go({ page: 'generate', recipeId: r.id })}>
                        <Play className="size-4" /> Generate
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Dashboards */}
      <section aria-labelledby="dash-h" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="dash-h" className="text-xl font-semibold tracking-tight">
            Dashboards
          </h2>
          <Button variant="outline" onClick={() => go({ page: 'dashboards' })}>
            <LayoutDashboard className="size-4" /> Open dashboards
          </Button>
        </div>
        {dashboards.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card/50 p-4 text-sm text-muted-foreground">
            No dashboards yet. After you generate a report, use <b>Open in dashboard</b> to see it as charts and compare months.
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {dashboards.map((d) => (
              <li key={d.id} className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                  <LayoutDashboard className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {d.tiles.length} tile{d.tiles.length === 1 ? '' : 's'} · updated {formatDate(d.updatedAt)}
                  </span>
                </span>
                <Button variant="outline" size="sm" onClick={() => go({ page: 'dashboards', dashboardId: d.id })}>
                  Open
                </Button>
                <MoreMenu title={d.name} onDuplicate={() => void duplicate('dashboard', d.id)} onDelete={() => setDoomed({ kind: 'dashboard', id: d.id, name: d.name })} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Backup */}
      <section aria-labelledby="backup-h" className="flex flex-col gap-4 rounded-xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h2 id="backup-h" className="font-semibold">
            Back up and share your setup
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            Recipes and dashboards are saved in this browser only. Export them to a file now and then, or to hand over to a colleague. Your Excel data is never included.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" onClick={() => lib().exportLibrary()} disabled={recipes.length + dashboards.length === 0}>
            <Download className="size-4" />
            Export library
          </Button>
          <Button variant="outline" onClick={() => fileInput.current?.click()}>
            <Upload className="size-4" />
            Import library
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="Choose a library file"
            onChange={(e) => {
              void pickLibraryFile(e.target.files?.[0]);
              e.target.value = ''; // lets the same file be chosen again
            }}
          />
        </div>
      </section>

      <ConfirmDialog
        open={doomed !== null}
        title={`Delete “${doomed?.name ?? ''}”?`}
        description="This cannot be undone. If you exported your library earlier, you can import it again to get it back."
        confirmLabel="Delete"
        destructive
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDoomed(null)}
      />
      <ImportDialog text={importText?.text ?? null} fileName={importText?.name ?? ''} onClose={() => setImportText(null)} />
    </div>
  );
}
