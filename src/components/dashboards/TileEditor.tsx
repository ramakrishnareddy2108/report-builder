import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { planTile } from '@/core/dashboard';
import { MEASURES } from '@/core/measures';
import {
  AGGREGATIONS,
  DIMENSIONS,
  DIMENSION_LABELS,
  TILE_TYPES,
  TILE_TYPE_LABELS,
  TileSchema,
  type Aggregation,
  type Comparison,
  type Dashboard,
  type Dimension,
  type SortOrder,
  type Tile,
  type TileType,
} from '@/core/schemas';
import type { MeasureCode } from '@/core/types';
import { PickList } from './PickList';

type Props = {
  /** The tile being edited; the dialog is open while this is set. */
  tile: Tile | null;
  dashboard: Dashboard;
  choices: Record<'doctors' | 'departments' | 'sponsors', string[]>;
  onSave: (tile: Tile) => void;
  onClose: () => void;
};

const AGG_LABELS: Record<Aggregation, string> = { sum: 'Sum', count: 'Count of rows with a value', avg: 'Average' };
const COMPARE_LABELS: Record<Comparison, string> = { none: 'No comparison', previousMonth: 'Previous month', sameMonthLastYear: 'Same month last year' };
const SORT_LABELS: Record<SortOrder, string> = { desc: 'Largest first', asc: 'Smallest first', name: 'By name' };
const NONE = '__none__';
const options = (names: readonly string[]) => names.map((n) => ({ value: n, label: n }));

/** Edit one tile: what to draw, which measure and how to add it up, filters, limit and comparison. */
export function TileEditor({ tile, dashboard, choices, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Tile | null>(tile);
  useEffect(() => setDraft(tile), [tile]);

  const checked = useMemo(() => (draft ? TileSchema.safeParse(draft) : null), [draft]);
  const plan = draft ? planTile(draft, dashboard) : null;
  if (!draft) return null;

  const set = <K extends keyof Tile>(key: K, value: Tile[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const isKpi = draft.type === 'kpi';
  const multi = draft.measures.length > 1;
  const issues = checked && !checked.success ? checked.error.issues.map((i) => i.message) : [];
  const problem = plan && !plan.ok ? plan.reason : null;
  const canSave = checked?.success === true && !problem;

  function setType(type: TileType) {
    // A pie draws one measure, once per slice: no split.
    setDraft((d) => (d ? { ...d, type, ...(type === 'pie' ? { split: null, measures: d.measures.slice(0, 1) } : {}) } : d));
  }
  // A pie draws one measure; with several measures each is its own series, so there is no split.
  const setMeasures = (list: string[]) =>
    setDraft((d) => {
      if (!d) return d;
      const measures = (d.type === 'pie' ? list.slice(-1) : list) as MeasureCode[];
      return { ...d, measures, ...(measures.length > 1 ? { split: null } : {}) };
    });
  const setFilter = (key: keyof Tile['filters'], list: string[]) => setDraft((d) => (d ? { ...d, filters: { ...d.filters, [key]: list } } : d));

  return (
    <Dialog open={tile !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit tile</DialogTitle>
          <DialogDescription>
            Numbers come from the saved Final months only. Amounts are added up exactly; Total Revenue and Gross Profit are the
            ones already worked out in each month.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Title</span>
            <Input value={draft.title} onChange={(e) => set('title', e.target.value)} aria-invalid={draft.title.trim() === ''} />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Show as">
              <Select value={draft.type} onValueChange={(v) => setType(v as TileType)}>
                <SelectTrigger aria-label="Show as">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TILE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TILE_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {!isKpi && (
              <Field label="X axis (rows)">
                <Select value={draft.x} onValueChange={(v) => setDraft((d) => (d ? { ...d, x: v as Dimension, split: d.split === v ? null : d.split } : d))}>
                  <SelectTrigger aria-label="X axis">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIMENSIONS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {DIMENSION_LABELS[d]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label="Add up as">
              <Select value={draft.agg} onValueChange={(v) => set('agg', v as Aggregation)}>
                <SelectTrigger aria-label="Add up as">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGGREGATIONS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {AGG_LABELS[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {!isKpi && draft.type !== 'pie' && (
              <Field label="Split by">
                <Select value={draft.split ?? NONE} disabled={multi} onValueChange={(v) => set('split', v === NONE ? null : (v as Dimension))}>
                  <SelectTrigger aria-label="Split by">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No split</SelectItem>
                    {DIMENSIONS.filter((d) => d !== draft.x).map((d) => (
                      <SelectItem key={d} value={d}>
                        {DIMENSION_LABELS[d]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>
          {multi && !isKpi && <p className="-mt-2 text-xs text-muted-foreground">With several measures, each measure is its own line or bar, so Split by is off.</p>}

          <PickList
            label="Measures"
            empty="Choose at least one"
            options={MEASURES.map((m) => ({ value: m.code, label: m.label }))}
            selected={draft.measures}
            onChange={setMeasures}
          />

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Only these (leave empty for all)</h3>
            <PickList label="Doctors" empty="All doctors" options={options(choices.doctors)} selected={draft.filters.doctors} onChange={(l) => setFilter('doctors', l)} />
            <PickList label="Departments" empty={dashboard.departments.length > 0 ? `Dashboard: ${dashboard.departments.join(', ')}` : 'All departments'} options={options(choices.departments)} selected={draft.filters.departments} onChange={(l) => setFilter('departments', l)} />
            <PickList label="Sponsors" empty={dashboard.sponsors.length > 0 ? `Dashboard: ${dashboard.sponsors.join(', ')}` : 'All sponsors'} options={options(choices.sponsors)} selected={draft.filters.sponsors} onChange={(l) => setFilter('sponsors', l)} />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {!isKpi && draft.x !== 'month' && (
              <>
                <Field label="Show the top">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    placeholder="All"
                    value={draft.topN ?? ''}
                    onChange={(e) => set('topN', e.target.value === '' ? null : Math.max(1, Math.min(100, Math.trunc(Number(e.target.value)))))}
                    aria-label="Show the top"
                  />
                </Field>
                <Field label="Order">
                  <Select value={draft.sort} onValueChange={(v) => set('sort', v as SortOrder)}>
                    <SelectTrigger aria-label="Order">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(SORT_LABELS) as SortOrder[]).map((s) => (
                        <SelectItem key={s} value={s}>
                          {SORT_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </>
            )}
            {(isKpi || draft.x !== 'month') && (
              <Field label="Compare">
                <Select value={draft.compare} onValueChange={(v) => set('compare', v as Comparison)}>
                  <SelectTrigger aria-label="Compare">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(COMPARE_LABELS) as Comparison[]).map((c) => (
                      <SelectItem key={c} value={c}>
                        {COMPARE_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>
          {draft.compare !== 'none' && (isKpi || draft.x !== 'month') && (
            <p className="-mt-2 text-xs text-muted-foreground">A comparison uses the latest month of the dashboard’s range, against the other month.</p>
          )}

          {(problem || issues.length > 0) && (
            <ul className="list-disc space-y-0.5 rounded-lg border border-destructive/40 bg-destructive/5 py-2 pr-3 pl-7 text-sm text-destructive" role="alert">
              {problem && <li>{problem}</li>}
              {issues.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={() => checked?.success && onSave(checked.data)}>
            Save tile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
