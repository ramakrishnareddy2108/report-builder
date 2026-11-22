import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { FormulaField, type FormulaExample } from '@/components/FormulaField';
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
const KIND_LABEL: Record<ReportColumn['kind'], string> = { group: 'Name', aggregate: 'Total', formula: 'Formula', serial: 'S.No.' };
const KIND_STYLE: Record<ReportColumn['kind'], string> = {
  group: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300',
  aggregate: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  formula: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
  serial: 'bg-muted text-muted-foreground',
};
const TYPES: { value: ColumnType; label: string }[] = [
  { value: 'money', label: 'Money (₹)' },
  { value: 'number', label: 'Number' },
  { value: 'text', label: 'Text' },
  { value: 'date', label: 'Date' },
];

/** Ready-made report formulas from the number columns already in the report. */
function formulaExamples(numeric: readonly string[]): FormulaExample[] {
  const [a, b, c] = numeric;
  if (!a || !b) return [];
  const out: FormulaExample[] = [
    { label: `Add: ${a} + ${b}`, formula: `[${a}]+[${b}]` },
    { label: `Subtract: ${a} − ${b}`, formula: `[${a}]-[${b}]` },
    { label: `Percentage: ${b} as % of ${a}`, formula: `IFERROR(ROUND([${b}]/[${a}]*100,2),0)` },
  ];
  if (c) out.splice(1, 0, { label: `Add three: ${a} + ${b} + ${c}`, formula: `[${a}]+[${b}]+[${c}]` });
  return out;
}

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
    <div className="space-y-3 rounded-xl border bg-card p-3 shadow-xs">
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className={`w-16 shrink-0 justify-center ${KIND_STYLE[col.kind]}`}>
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
            label="Calculate this column as"
            value={col.formula}
            onChange={(v) => patch((c) => ((c as Formula).formula = v))}
            columns={others}
            columnsLabel="Other columns of this report"
            columnExists={(n) => others.some((o) => o.toUpperCase() === n.toUpperCase())}
            placeholder="[IP Revenue]+[OP Revenue]"
            hint="Works on each report line, like a formula across one row in Excel."
            examples={formulaExamples(recipe.report.columns.filter((c, i) => i !== index && (c.kind === 'aggregate' || c.kind === 'formula') && (c.type === 'money' || c.type === 'number')).map((c) => c.name))}
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

  const verb = { SUM: 'Adds up', COUNT: 'Counts the rows', COUNTDISTINCT: 'Counts the different values of', AVG: 'Averages', MIN: 'Takes the smallest', MAX: 'Takes the largest' }[col.agg];
  const what = col.agg === 'COUNT' ? '' : ` ${col.of ?? '…'}`;
  const fromText =
    selected === null ? 'from the rows that meet the custom condition' : selected.length === 0 ? 'from every file' : `from ${selected.join(selected.length === 2 ? ' and ' : ', ')}`;

  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
        <span className="text-muted-foreground">In words: </span>
        {verb}
        <b>{what}</b> {fromText}, for each line of the report.
      </p>
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
            columnsLabel="Columns of the combined data"
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
