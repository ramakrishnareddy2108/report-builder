import { BookOpen, Copy, Download, Sparkles, EllipsisVertical, LayoutDashboard, Pencil, Play, Plus, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useLibrary } from '@/app/libraryStore';
import { useAppStore } from '@/app/store';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { blankRecipe } from '@/recipe/blank';
import { STARTER_IDS } from '@/recipe/defaults';
import { checkRecipe, hasProblems } from '@/recipe/validate';
import { ImportDialog } from './ImportDialog';

const formatDate = (iso: string | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

type Doomed = { kind: 'recipe' | 'dashboard'; id: string; name: string };

/** A row of a list: a title, a small line, and buttons. Stacks on phones. */
function ItemCard(props: {
  title: string;
  detail: string;
  /** Shown in amber under the detail line, for example when a recipe is not finished. */
  attention?: string;
  primary: { label: string; icon: typeof Play; onClick: () => void };
  secondary?: { label: string; icon: typeof Play; onClick: () => void };
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { title, detail, attention, primary, secondary, onDuplicate, onDelete } = props;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{title}</h3>
          <p className="text-sm text-muted-foreground">{detail}</p>
          {attention && <p className="text-sm font-medium text-amber-700 dark:text-amber-400">{attention}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={primary.onClick} className="flex-1 sm:flex-none">
            <primary.icon className="size-4" />
            {primary.label}
          </Button>
          {secondary && (
            <Button variant="outline" onClick={secondary.onClick} className="flex-1 sm:flex-none">
              <secondary.icon className="size-4" />
              {secondary.label}
            </Button>
          )}
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
        </div>
      </CardContent>
    </Card>
  );
}

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
    if (n > 0) toast.success(`Added ${n} starter recipe${n === 1 ? '' : 's'}. Open one and add its Excel template to begin.`);
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

  if (status === 'loading') return <p className="text-sm text-muted-foreground" role="status">Loading your recipes…</p>;
  if (status === 'error') {
    return (
      <p role="alert" className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader title="Your reports" description="Open a recipe, add this month's files, and download the report." />

      <section aria-labelledby="recipes-h" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="recipes-h" className="text-lg font-medium">
            Recipes
          </h2>
          <div className="flex flex-wrap gap-2">
            {missingStarters && recipes.length > 0 && (
              <Button variant="outline" onClick={() => void addStarters()}>
                <Sparkles className="size-4" />
                Add starter recipes
              </Button>
            )}
            <Button onClick={() => void newRecipe()}>
              <Plus className="size-4" />
              New recipe
            </Button>
          </div>
        </div>

        {recipes.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No recipes yet"
            description="A recipe tells the app how to turn your Excel exports into a finished report. Create one once, then use it every month."
            action={
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={() => void addStarters()}>
                  <Sparkles className="size-4" />
                  Add starter recipes: DRR, Sponsor-wise
                </Button>
                <Button variant="outline" onClick={() => void newRecipe()}>
                  <Plus className="size-4" />
                  Start from scratch
                </Button>
              </div>
            }
          />
        ) : (
          recipes.map((r) => (
            <ItemCard
              key={r.id}
              title={r.name}
              detail={`${r.sources.length} source${r.sources.length === 1 ? '' : 's'} · updated ${formatDate(r.updatedAt)}`}
              attention={hasProblems(checkRecipe(r)) ? 'Not finished: open it to see what is missing.' : undefined}
              primary={{ label: 'Generate', icon: Play, onClick: () => go({ page: 'generate', recipeId: r.id }) }}
              secondary={{ label: 'Edit', icon: Pencil, onClick: () => go({ page: 'recipe', recipeId: r.id }) }}
              onDuplicate={() => void duplicate('recipe', r.id)}
              onDelete={() => setDoomed({ kind: 'recipe', id: r.id, name: r.name })}
            />
          ))
        )}
      </section>

      <section aria-labelledby="dash-h" className="space-y-3">
        <h2 id="dash-h" className="text-lg font-medium">
          Dashboards
        </h2>
        {dashboards.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No dashboards yet. Open the Dashboards page to build one from a finished report.
          </p>
        ) : (
          dashboards.map((d) => (
            <ItemCard
              key={d.id}
              title={d.name}
              detail={`${d.tiles.length} tile${d.tiles.length === 1 ? '' : 's'} · updated ${formatDate(d.updatedAt)}`}
              primary={{ label: 'Open', icon: LayoutDashboard, onClick: () => go({ page: 'dashboards', dashboardId: d.id }) }}
              onDuplicate={() => void duplicate('dashboard', d.id)}
              onDelete={() => setDoomed({ kind: 'dashboard', id: d.id, name: d.name })}
            />
          ))
        )}
      </section>

      <section aria-labelledby="backup-h" className="space-y-3 rounded-lg border p-4">
        <h2 id="backup-h" className="text-lg font-medium">
          Back up and share
        </h2>
        <p className="text-sm text-muted-foreground">
          Recipes and dashboards are saved in this browser only. Export them to a file to keep a backup or to share with a colleague. Your Excel data is never saved.
        </p>
        <div className="flex flex-wrap gap-2">
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
