import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { FormulaField } from '@/components/FormulaField';
import { NativeSelect } from '@/components/NativeSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { combinedColumns } from '@/recipe/columns';
import type { AggregateFn, ColumnType, Recipe, ReportColumn } from '@/recipe/schema';
import { buildSourceFilter, parseSourceFilter } from '@/recipe/sourceFilter';
import { useBuilder } from './builderStore';

type Agg = Extract<ReportColumn, { kind: 'aggregate' }>;
type Formula = Extract<ReportColumn, { kind: 'formula' }>;

const AGGS: { value: AggregateFn; label: string }[] = [
  { value: 'SUM', label: 'Sum (add up)' },
  { value: 'COUNT', label: 'Count rows' },
  { value: 'COUNTDISTINCT', label: 'Count different values' },
  { value: 'AVG', label: 'Average' },
  { value: 'MIN', label: 'Smallest' },
  { value: 'MAX', label: 'Largest' },
];
const KIND_LABEL: Record<ReportColumn['kind'], string> = { group: 'Group', aggregate: 'Total', formula: 'Formula', serial: 'Number' };
const TYPES: { value: ColumnType; label: string }[] = [
  { value: 'money', label: 'Money (₹)' },
  { value: 'number', label: 'Number' },
  { value: 'text', label: 'Text' },
  { value: 'date', label: 'Date' },
];

/** The type a total should have: counts are numbers, the rest follow the column they work on. */
export function aggregateType(agg: AggregateFn, ofType: ColumnType | undefined): ColumnType {
  if (agg === 'COUNT' || agg === 'COUNTDISTINCT') return 'number';
  return ofType ?? 'number';
}

export function ReportColumnCard({ index, total }: { index: number; total: number }) {
  const recipe = useBuilder((s) => s.recipe);
  const update = useBuilder((s) => s.update);
  const col = recipe?.report.columns[index];
  if (!recipe || !col) return null;

  const all = combinedColumns(recipe);
  const patch = (fn: (c: ReportColumn) => void) => update((r) => void fn(r.report.columns[index] as ReportColumn));
  const move = (by: -1 | 1) =>
    update((r) => {
      const list = r.report.columns;
      const j = index + by;
      if (j < 0 || j >= list.length) return;
      [list[index], list[j]] = [list[j] as ReportColumn, list[index] as ReportColumn];
    });
  const others = recipe.report.columns.filter((_, i) => i !== index).map((c) => c.name).filter((n) => n.trim() !== '');

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="shrink-0">
          {KIND_LABEL[col.kind]}
        </Badge>
        <Input value={col.name} onChange={(e) => patch((c) => (c.name = e.target.value))} aria-label="Column heading" placeholder="Heading in the report" aria-invalid={col.name.trim() === ''} />
        <Button variant="ghost" size="icon" aria-label="Move up" disabled={index === 0} onClick={() => move(-1)}>
          <ArrowUp className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Move down" disabled={index === total - 1} onClick={() => move(1)}>
          <ArrowDown className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label={`Remove ${col.name || 'column'}`} onClick={() => update((r) => void r.report.columns.splice(index, 1))}>
          <Trash2 className="size-4" />
        </Button>
      </div>

      {col.kind === 'group' && (
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Shows</span>
          <NativeSelect value={col.from} onChange={(e) => patch((c) => ((c as Extract<ReportColumn, { kind: 'group' }>).from = e.target.value))}>
            {!recipe.report.groupBy.includes(col.from) && <option value={col.from}>{col.from || 'Choose…'}</option>}
            {recipe.report.groupBy.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </NativeSelect>
          <span className="block text-xs text-muted-foreground">Only columns chosen in “One row for each” above can be shown.</span>
        </label>
      )}

      {col.kind === 'aggregate' && <AggregateEditor col={col} recipe={recipe} patch={(fn) => patch((c) => fn(c as Agg))} all={all} />}

      {col.kind === 'formula' && (
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <FormulaField
            label="Formula (uses other columns of this report)"
            value={col.formula}
            onChange={(v) => patch((c) => ((c as Formula).formula = v))}
            columns={others}
            columnExists={(n) => others.some((o) => o.toUpperCase() === n.toUpperCase())}
            placeholder="[IP Revenue]+[OP Revenue]"
          />
          <label className="space-y-1 text-sm">
            <span className="font-medium">Type</span>
            <NativeSelect value={col.type} onChange={(e) => patch((c) => ((c as Formula).type = e.target.value as ColumnType))}>
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
      )}

      {col.kind === 'serial' && <p className="text-xs text-muted-foreground">Numbers the rows 1, 2, 3… after sorting.</p>}
    </div>
  );
}

function AggregateEditor({ col, recipe, patch, all }: { col: Agg; recipe: Recipe; patch: (fn: (c: Agg) => void) => void; all: ReturnType<typeof combinedColumns> }) {
  const numeric = all.filter((c) => c.type === 'money' || c.type === 'number');
  const choices = col.agg === 'SUM' || col.agg === 'AVG' ? numeric : all.filter((c) => !c.name.startsWith('_') || c.name === '_row');
  const sources = recipe.sources.map((s) => s.label).filter((l) => l.trim() !== '');
  const selected = parseSourceFilter(col.where);
  const needsOf = col.agg !== 'COUNT';

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Calculation</span>
          <NativeSelect
            value={col.agg}
            onChange={(e) =>
              patch((c) => {
                c.agg = e.target.value as AggregateFn;
                c.type = aggregateType(c.agg, all.find((x) => x.name === c.of)?.type);
              })
            }
          >
            {AGGS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Of this column{needsOf ? '' : ' (optional)'}</span>
          <NativeSelect
            value={col.of ?? ''}
            aria-invalid={needsOf && !col.of}
            onChange={(e) =>
              patch((c) => {
                c.of = e.target.value || undefined;
                c.type = aggregateType(c.agg, all.find((x) => x.name === c.of)?.type);
              })
            }
          >
            <option value="">{needsOf ? 'Choose…' : '(count every row)'}</option>
            {col.of && !choices.some((c) => c.name === col.of) && <option value={col.of}>{col.of} (not available)</option>}
            {choices.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Type</span>
          <NativeSelect value={col.type} onChange={(e) => patch((c) => (c.type = e.target.value as ColumnType))}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Only count rows from</legend>
        {selected === null ? (
          <p className="text-xs text-muted-foreground">A custom condition is set below.</p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {sources.map((label) => (
              <label key={label} className="flex min-h-9 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={selected.includes(label)}
                  onChange={(e) => patch((c) => (c.where = buildSourceFilter(e.target.checked ? [...selected, label] : selected.filter((l) => l !== label)) || undefined))}
                />
                {label}
              </label>
            ))}
            {selected.length === 0 && <span className="text-xs text-muted-foreground">(all sources)</span>}
          </div>
        )}
      </fieldset>

      <details className="rounded-lg border p-2.5" open={selected === null}>
        <summary className="cursor-pointer text-sm font-medium">Custom condition</summary>
        <div className="mt-2">
          <FormulaField
            label="Count a row only when"
            value={col.where ?? ''}
            onChange={(v) => patch((c) => (c.where = v === '' ? undefined : v))}
            columns={all.map((c) => c.name)}
            columnExists={(n) => all.some((c) => c.name.toUpperCase() === n.toUpperCase())}
            placeholder={'[Source]="OP Billing"'}
            hint="Leave empty to count every row of the group."
            optional
          />
        </div>
      </details>
    </div>
  );
}
