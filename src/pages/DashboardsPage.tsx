import { FolderOpen, LayoutDashboard, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useMonthOverviews } from '@/app/monthActions';
import { useSettings } from '@/app/settingsStore';
import { useWorkspace } from '@/app/useWorkspace';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DashboardToolbar } from '@/components/dashboards/DashboardToolbar';
import { TileCard } from '@/components/dashboards/TileCard';
import { TileEditor } from '@/components/dashboards/TileEditor';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { SettingsGate } from '@/components/SettingsGate';
import { Button } from '@/components/ui/button';
import { filterChoices, finalMonths, runDashboard } from '@/core/dashboard';
import {
  addDashboard,
  addTile,
  deleteDashboard,
  deleteTile,
  duplicateDashboard,
  emptyDashboard,
  moveTile,
  newTile,
  updateDashboard,
  updateTile,
} from '@/core/dashboardEdit';
import { MONTHLY_REVIEW_ID, starterDashboardsFile } from '@/core/dashboardStarters';
import type { Dashboard, DashboardsFile, Tile } from '@/core/schemas';
import type { Workspace } from '@/storage/workspace';

export function DashboardsPage() {
  const ws = useWorkspace();
  const header = (
    <PageHeader
      title="Dashboards"
      description="Charts and numbers from your saved Final months. Open a dashboard, or build your own from tiles."
    />
  );
  if (!ws) {
    return (
      <>
        {header}
        <EmptyState
          icon={FolderOpen}
          title="Choose a workspace folder first"
          description="Dashboards use the months saved in the workspace folder. Open the Workspace page to choose it."
        />
      </>
    );
  }
  return (
    <>
      {header}
      <SettingsGate>
        <DashboardsWorkspace ws={ws} />
      </SettingsGate>
    </>
  );
}

function DashboardsWorkspace({ ws }: { ws: Workspace }) {
  const stored = useSettings((s) => s.dashboards);
  const saveDashboards = useSettings((s) => s.saveDashboards);
  const { overviews, error } = useMonthOverviews(ws);
  const [selected, setSelected] = useState<string>(MONTHLY_REVIEW_ID);
  const [editing, setEditing] = useState<Tile | null>(null);
  const [deleting, setDeleting] = useState<Tile | null>(null);

  // The first time, the starter dashboards are saved so they can be edited like any other.
  useEffect(() => {
    if (stored === null) void saveDashboards(starterDashboardsFile()).catch((err: unknown) => toast.error(`Could not save the starter dashboards: ${err instanceof Error ? err.message : String(err)}`));
  }, [stored, saveDashboards]);

  const months = useMemo(() => (overviews ?? []).flatMap((o) => (o.bestData ? [o.bestData] : [])), [overviews]);
  const finals = useMemo(() => finalMonths(months), [months]);
  const choices = useMemo(() => filterChoices(months), [months]);

  const file = stored;
  const dashboard = file?.dashboards.find((d) => d.id === selected) ?? file?.dashboards[0];
  const data = useMemo(() => (dashboard ? runDashboard(dashboard, months) : []), [dashboard, months]);

  async function apply(next: DashboardsFile, after?: () => void) {
    try {
      await saveDashboards(next);
      after?.();
    } catch (err) {
      toast.error(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (error) {
    return (
      <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
        Could not read the saved months: {error}
      </p>
    );
  }
  if (!file || !overviews) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading the dashboards…
      </p>
    );
  }
  if (!dashboard) {
    return (
      <EmptyState
        icon={LayoutDashboard}
        title="No dashboard yet"
        description="Create one, then add tiles to it."
        action={
          <Button
            onClick={() => {
              const d = emptyDashboard('My dashboard', []);
              void apply(addDashboard(file, d), () => setSelected(d.id));
            }}
          >
            Create a dashboard
          </Button>
        }
      />
    );
  }

  const patch = (p: Partial<Pick<Dashboard, 'months' | 'departments' | 'sponsors'>>) => void apply(updateDashboard(file, dashboard.id, p));
  const ids = file.dashboards.map((d) => d.id);

  return (
    <div className="space-y-5">
      <DashboardToolbar
        file={file}
        dashboard={dashboard}
        finalMonths={finals.map((m) => m.month)}
        choices={choices}
        onSelect={setSelected}
        onCreate={(name) => {
          const d = emptyDashboard(name, ids);
          void apply(addDashboard(file, d), () => setSelected(d.id));
        }}
        onRename={(name) => void apply(updateDashboard(file, dashboard.id, { name }))}
        onDuplicate={(name) => {
          const next = duplicateDashboard(file, dashboard.id, name);
          void apply(next, () => setSelected(next.dashboards.at(-1)?.id ?? dashboard.id));
        }}
        onDelete={() => void apply(deleteDashboard(file, dashboard.id), () => setSelected(file.dashboards.find((d) => d.id !== dashboard.id)?.id ?? ''))}
        onChange={patch}
        onAddTile={() => setEditing(newTile('New tile', dashboard.tiles.map((t) => t.id)))}
      />

      {finals.length === 0 && (
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          There is no Final month yet, so the tiles are empty. Run a month on the Run page and make it Final (or import a past DRR on the Months page).
        </p>
      )}

      {dashboard.tiles.length === 0 ? (
        <EmptyState icon={LayoutDashboard} title="No tiles yet" description="Add a tile to show a number or a chart." action={<Button onClick={() => setEditing(newTile('New tile', []))}>Add a tile</Button>} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {dashboard.tiles.map((tile, i) => (
            <TileCard
              key={tile.id}
              tile={tile}
              data={data[i] as (typeof data)[number]}
              first={i === 0}
              last={i === dashboard.tiles.length - 1}
              onMove={(direction) => void apply(moveTile(file, dashboard.id, tile.id, direction))}
              onEdit={() => setEditing(tile)}
              onDelete={() => setDeleting(tile)}
            />
          ))}
        </div>
      )}

      <TileEditor
        tile={editing}
        dashboard={dashboard}
        choices={choices}
        onClose={() => setEditing(null)}
        onSave={(tile) => {
          const exists = dashboard.tiles.some((t) => t.id === tile.id);
          void apply(exists ? updateTile(file, dashboard.id, tile) : addTile(file, dashboard.id, tile), () => setEditing(null));
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete the tile “${deleting?.title ?? ''}”?`}
        description="The tile is removed from this dashboard. Your saved months are not touched."
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void apply(deleteTile(file, dashboard.id, deleting.id));
          setDeleting(null);
        }}
      />
    </div>
  );
}
