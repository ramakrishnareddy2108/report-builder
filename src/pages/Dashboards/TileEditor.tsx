import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { FormulaField } from '@/components/FormulaField';
import { NativeSelect } from '@/components/NativeSelect';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { DashColumn } from '@/dashboard/data';
import { TileSchema, type Tile, type TileAgg, type TileType } from '@/dashboard/schema';

const TYPES: { value: TileType; label: string }[] = [
  { value: 'kpi', label: 'A single number' },
  { value: 'bar', label: 'Bar chart' },
  { value: 'stackedBar', label: 'Stacked bar chart' },
  { value: 'line', label: 'Line chart' },
  { value: 'pie', label: 'Pie chart' },
  { value: 'table', label: 'Table' },
];
const AGGS: { value: TileAgg; label: string }[] = [
  { value: 'SUM', label: 'Sum (add up)' },
  { value: 'COUNT', label: 'Count' },
  { value: 'AVG', label: 'Average' },
  { value: 'MIN', label: 'Smallest' },
  { value: 'MAX', label: 'Largest' },
];

type Props = {
  /** The tile to edit; null keeps the dialog closed. */
  tile: Tile | null;
  isNew: boolean;
  columns: readonly DashColumn[];
  /** Names the template needs, offered when no data is loaded yet. */
  fallbackColumns: readonly string[];
  onSave: (tile: Tile) => void;
  onClose: () => void;
};

export function TileEditor({ tile, isNew, columns, fallbackColumns, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Tile | null>(tile);
  const listId = useId();
  useEffect(() => setDraft(tile), [tile]);
  if (!draft) return null;

  const names = columns.length > 0 ? columns.map((c) => c.name).filter((n) => !n.startsWith('_')) : [...fallbackColumns];
  const numeric = columns.length > 0 ? columns.filter((c) => c.type === 'money' || c.type === 'number').map((c) => c.name) : names;
  const patch = (change: Partial<Tile>) => setDraft((d) => (d ? { ...d, ...change } : d));
  const clean = (): Tile => {
    const t: Tile = { ...draft, extraY: draft.extraY?.length ? draft.extraY : undefined };
    if (t.type === 'kpi') {
      t.x = undefined;
      t.splitBy = undefined;
      t.extraY = undefined;
      t.topN = undefined;
      t.sort = undefined;
    }
    if (!t.splitBy) t.splitBy = undefined;
    if (!t.x) t.x = undefined;
    if (!t.filter?.trim()) t.filter = undefined;
    if (!t.compare?.column) t.compare = undefined;
    return t;
  };
  const parsed = TileSchema.safeParse(clean());
  const needsX = draft.type !== 'kpi';
  const problem = !parsed.success ? (draft.title.trim() === '' ? 'Give the tile a title.' : 'Choose the column to add up.') : needsX && !draft.x ? 'Choose what to group by (X).' : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Add a tile' : 'Edit tile'}</DialogTitle>
          <DialogDescription>Each tile shows one thing from the report: a number, a chart or a table.</DialogDescription>
        </DialogHeader>

        <datalist id={listId}>
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Title</span>
              <Input value={draft.title} onChange={(e) => patch({ title: e.target.value })} aria-invalid={draft.title.trim() === ''} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Show as</span>
              <NativeSelect value={draft.type} onChange={(e) => patch({ type: e.target.value as TileType })}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </div>

          {needsX && (
            <label className="block space-y-1 text-sm">
              <span className="font-medium">One {draft.type === 'table' ? 'row' : 'bar or point'} for each…</span>
              <Input list={listId} value={draft.x ?? ''} onChange={(e) => patch({ x: e.target.value })} placeholder="e.g. Doctor Name" aria-invalid={!draft.x} />
            </label>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Measure</span>
              <Input list={listId} value={draft.y.column} onChange={(e) => patch({ y: { ...draft.y, column: e.target.value } })} placeholder="e.g. Total Revenue" aria-invalid={draft.y.column.trim() === ''} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Calculation</span>
              <NativeSelect value={draft.y.agg} onChange={(e) => patch({ y: { ...draft.y, agg: e.target.value as TileAgg } })}>
                {AGGS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </div>
          {numeric.length > 0 && columns.length > 0 && !numeric.includes(draft.y.column) && draft.y.column !== '' && draft.y.agg !== 'COUNT' && (
            <p className="-mt-2 text-xs text-amber-700">“{draft.y.column}” is not a number column in the loaded data.</p>
          )}

          {needsX && draft.type !== 'pie' && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">More measures (optional)</h4>
              {(draft.extraY ?? []).map((m, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
                  <Input list={listId} value={m.column} onChange={(e) => patch({ extraY: (draft.extraY ?? []).map((x, j) => (j === i ? { ...x, column: e.target.value } : x)) })} aria-label="More measure" placeholder="Another column" />
                  <NativeSelect value={m.agg} onChange={(e) => patch({ extraY: (draft.extraY ?? []).map((x, j) => (j === i ? { ...x, agg: e.target.value as TileAgg } : x)) })} aria-label="Calculation">
                    {AGGS.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => patch({ extraY: (draft.extraY ?? []).filter((_, j) => j !== i) })}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => patch({ extraY: [...(draft.extraY ?? []), { column: '', agg: 'SUM' }] })}>
                <Plus className="size-4" /> Add a measure
              </Button>
            </div>
          )}

          {needsX && (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1 text-sm">
                <span className="font-medium">Split by (optional)</span>
                <Input list={listId} value={draft.splitBy ?? ''} onChange={(e) => patch({ splitBy: e.target.value })} placeholder="e.g. Department" disabled={(draft.extraY?.length ?? 0) > 0} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Only the top… (optional)</span>
                <Input type="number" min={1} value={draft.topN ?? ''} onChange={(e) => patch({ topN: e.target.value === '' ? undefined : Math.max(1, Math.floor(Number(e.target.value) || 1)) })} placeholder="e.g. 15" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Order</span>
                <NativeSelect value={draft.sort ?? ''} onChange={(e) => patch({ sort: (e.target.value || undefined) as Tile['sort'] })}>
                  <option value="">Automatic</option>
                  <option value="valueDesc">Largest first</option>
                  <option value="valueAsc">Smallest first</option>
                  <option value="label">By name (months in order)</option>
                </NativeSelect>
              </label>
            </div>
          )}

          <label className="block space-y-1 text-sm">
            <span className="font-medium">Compare with the previous… (optional)</span>
            <Input list={listId} value={draft.compare?.column ?? ''} onChange={(e) => patch({ compare: e.target.value ? { column: e.target.value, mode: 'previous' } : undefined })} placeholder="e.g. Month" />
            <span className="block text-xs text-muted-foreground">Shows the change against the previous month (load two or more months to see it).</span>
          </label>

          <FormulaField
            label="Only rows where (optional)"
            value={draft.filter ?? ''}
            onChange={(v) => patch({ filter: v })}
            columns={names}
            columnExists={columns.length > 0 ? (n) => columns.some((c) => c.name.toUpperCase() === n.toUpperCase()) : undefined}
            placeholder='[Department] = "Cardiology"'
            optional
          />
        </div>

        <DialogFooter>
          {problem && <span className="mr-auto self-center text-sm text-muted-foreground">{problem}</span>}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={problem !== null} onClick={() => parsed.success && onSave(parsed.data)}>
            {isNew ? 'Add tile' : 'Save tile'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
