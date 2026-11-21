import { Copy, EllipsisVertical, LayoutDashboard, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useLibrary } from '@/app/libraryStore';
import { useAppStore } from '@/app/store';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { missingColumns } from '@/dashboard/data';
import { STARTER_DASHBOARD_ID, starterDashboards } from '@/dashboard/defaults';
import type { Tile } from '@/dashboard/schema';
import { filterValues } from '@/dashboard/tiles';
import { useUnsavedWarning } from '@/lib/useUnsavedWarning';
import { blankDashboard } from '@/recipe/blank';
import { columnsUsed, useDash } from './dashStore';
import { DataBar } from './DataBar';
import { MultiPick } from './MultiPick';
import { TileCard } from './TileCard';
import { TileEditor } from './TileEditor';

function Picker() {
  const dashboards = useLibrary((s) => s.dashboards);
  const status = useLibrary((s) => s.status);
  const go = useAppStore((s) => s.go);
  const hasStarter = dashboards.some((d) => d.id === STARTER_DASHBOARD_ID);

  async function create() {
    const saved = await useLibrary.getState().saveDashboard(blankDashboard('New dashboard'));
    go({ page: 'dashboards', dashboardId: saved.id });
  }
  async function addStarter() {
    for (const d of starterDashboards()) await useLibrary.getState().saveDashboard(d);
    toast.success('Added “DRR Monthly Review”.');
  }

  if (status === 'loading') return <p className="text-sm text-muted-foreground" role="status">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboards</h1>
        <p className="mt-1 text-sm text-muted-foreground">Charts and totals from your finished reports. Compare months by loading several reports.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void create()}>
          <Plus className="size-4" /> New dashboard
        </Button>
        {!hasStarter && (
          <Button variant="outline" onClick={() => void addStarter()}>
            <Sparkles className="size-4" /> Add “DRR Monthly Review”
          </Button>
        )}
      </div>
      {dashboards.length === 0 ? (
        <EmptyState icon={LayoutDashboard} title="No dashboards yet" description="Start from the ready-made DRR Monthly Review, or build your own from any report." />
      ) : (
        <ul className="space-y-3">
          {dashboards.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => go({ page: 'dashboards', dashboardId: d.id })}
                className="flex min-h-16 w-full items-center gap-3 rounded-lg border p-4 text-left hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <LayoutDashboard className="size-5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {d.tiles.length} tile{d.tiles.length === 1 ? '' : 's'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Doomed = { kind: 'tile'; id: string; title: string } | { kind: 'dashboard' };

function View({ id }: { id: string }) {
  const go = useAppStore((s) => s.go);
  const saved = useLibrary((s) => s.dashboards.find((d) => d.id === id));
  const { draft, dirty, data, filters } = useDash();
  const [editing, setEditing] = useState<{ tile: Tile; isNew: boolean } | null>(null);
  const [doomed, setDoomed] = useState<Doomed | null>(null);

  useEffect(() => {
    if (saved) useDash.getState().open(saved);
  }, [saved]);
  useUnsavedWarning(dirty);

  const needed = useMemo(() => (draft ? [...new Set([...draft.requiredColumns, ...columnsUsed(draft)])] : []), [draft]);
  const missing = useMemo(() => (data.rows.length > 0 ? missingColumns(needed, data) : []), [needed, data]);

  if (!draft || draft.id !== id) return <p className="text-sm text-muted-foreground" role="status">Opening…</p>;
  const { update, save, setFilter } = useDash.getState();
  const dataColumns = data.columns;

  function newTile(): Tile {
    const num = dataColumns.find((c) => c.type === 'money') ?? dataColumns.find((c) => c.type === 'number');
    const txt = dataColumns.find((c) => c.type === 'text' && !c.name.startsWith('_') && c.name !== 'Month');
    return { id: '', title: 'New tile', type: 'bar', x: txt?.name, y: { column: num?.name ?? '', agg: 'SUM' } };
  }

  function move(i: number, by: -1 | 1) {
    update((d) => {
      const j = i + by;
      if (j < 0 || j >= d.tiles.length) return;
      [d.tiles[i], d.tiles[j]] = [d.tiles[j] as Tile, d.tiles[i] as Tile];
    });
  }

  async function duplicate() {
    const copy = await useLibrary.getState().duplicateDashboard(id);
    if (copy) {
      toast.success(`Created “${copy.name}”.`);
      go({ page: 'dashboards', dashboardId: copy.id });
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => go({ page: 'dashboards' })}>
          ← All dashboards
        </Button>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            value={draft.name}
            onChange={(e) => update((d) => void (d.name = e.target.value))}
            aria-label="Dashboard name"
            className="h-11 text-lg font-semibold md:h-10 md:text-xl"
            aria-invalid={draft.name.trim() === ''}
          />
          <div className="flex shrink-0 gap-2">
            <Button onClick={() => void save()} disabled={!dirty}>
              <Save className="size-4" /> {dirty ? 'Save' : 'Saved'}
            </Button>
            <Button variant="outline" onClick={() => setEditing({ tile: newTile(), isNew: true })}>
              <Plus className="size-4" /> Add tile
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More">
                  <EllipsisVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void duplicate()}>
                  <Copy className="size-4" /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDoomed({ kind: 'dashboard' })} className="text-destructive">
                  <Trash2 className="size-4" /> Delete dashboard
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {dirty && <p className="text-sm text-amber-700 dark:text-amber-400">You have changes that are not saved yet.</p>}
      </div>

      <DataBar />

      {missing.length > 0 && (
        <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
          This dashboard needs {missing.length === 1 ? 'a column' : 'columns'} that {missing.length === 1 ? 'is' : 'are'} not in the loaded data: <b>{missing.join(', ')}</b>. Load the right report, or change the tiles that use{' '}
          {missing.length === 1 ? 'it' : 'them'}.
        </p>
      )}

      {data.rows.length > 0 && draft.filters.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Filters">
          {draft.filters.map((f) => (
            <MultiPick key={f.column} label={f.label || f.column} options={filterValues(data, f.column)} selected={filters[f.column] ?? []} onChange={(v) => setFilter(f.column, v)} />
          ))}
        </div>
      )}

      {draft.tiles.length === 0 ? (
        <EmptyState icon={LayoutDashboard} title="No tiles yet" description="A tile shows one thing: a number, a chart or a table." action={<Button onClick={() => setEditing({ tile: newTile(), isNew: true })}>Add the first tile</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {draft.tiles.map((t, i) => (
            <TileCard
              key={t.id}
              tile={t}
              data={data}
              filters={filters}
              first={i === 0}
              last={i === draft.tiles.length - 1}
              onEdit={() => setEditing({ tile: t, isNew: false })}
              onMove={(by) => move(i, by)}
              onDelete={() => setDoomed({ kind: 'tile', id: t.id, title: t.title })}
            />
          ))}
        </div>
      )}

      <TileEditor
        tile={editing?.tile ?? null}
        isNew={editing?.isNew ?? false}
        columns={dataColumns}
        fallbackColumns={needed}
        onClose={() => setEditing(null)}
        onSave={(t) => {
          if (editing?.isNew) useDash.getState().addTile({ ...t });
          else update((d) => void (d.tiles = d.tiles.map((x) => (x.id === t.id ? t : x))));
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={doomed !== null}
        title={doomed?.kind === 'tile' ? `Delete the tile “${doomed.title}”?` : `Delete “${draft.name}”?`}
        description={doomed?.kind === 'tile' ? 'The tile is removed from this dashboard. Save the dashboard to keep the change.' : 'The dashboard layout is removed from this browser. Your reports are not affected.'}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (doomed?.kind === 'tile') {
            const tileId = doomed.id;
            update((d) => void (d.tiles = d.tiles.filter((x) => x.id !== tileId)));
          } else if (doomed?.kind === 'dashboard') {
            void useLibrary.getState().deleteDashboard(id).then(() => go({ page: 'dashboards' }));
          }
          setDoomed(null);
        }}
        onCancel={() => setDoomed(null)}
      />
    </div>
  );
}

export function DashboardsPage() {
  const id = useAppStore((s) => s.route.dashboardId);
  const status = useLibrary((s) => s.status);
  const exists = useLibrary((s) => s.dashboards.some((d) => d.id === id));
  const go = useAppStore((s) => s.go);

  if (!id) return <Picker />;
  if (status === 'loading') return <p className="text-sm text-muted-foreground" role="status">Loading…</p>;
  if (!exists) {
    return <EmptyState icon={LayoutDashboard} title="That dashboard was not found" description="It may have been deleted." action={<Button onClick={() => go({ page: 'dashboards' })}>See all dashboards</Button>} />;
  }
  return <View id={id} />;
}
