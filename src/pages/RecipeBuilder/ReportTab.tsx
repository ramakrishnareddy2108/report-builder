import { ArrowDown, ArrowUp, Hash, Plus, Sigma, Sparkles, Trash2, Users, X } from 'lucide-react';
import { ReportGrid } from '@/components/ReportGrid';
import { IssueList } from '@/components/IssueList';
import { NativeSelect } from '@/components/NativeSelect';
import { Button } from '@/components/ui/button';
import { combinedColumns } from '@/recipe/columns';
import type { ReportColumn } from '@/recipe/schema';
import { useBuilder } from './builderStore';
import { usePreviewAuto } from './previewStore';
import { aggregateType, ReportColumnCard } from './ReportColumnCard';

const move = <T,>(list: T[], i: number, by: -1 | 1) => {
  const j = i + by;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j] as T, list[i] as T];
};

/** Tab 3: one row for each…, the columns, sort, totals, and a live preview. */
export function ReportTab() {
  const recipe = useBuilder((s) => s.recipe);
  const update = useBuilder((s) => s.update);
  const hasSamples = useBuilder((s) => Object.keys(s.samples).length > 0);
  const preview = usePreviewAuto('report');
  if (!recipe) return null;

  const all = combinedColumns(recipe);
  const { report } = recipe;
  const free = all.filter((c) => !report.groupBy.some((g) => g.toUpperCase() === c.name.toUpperCase()) && !c.name.startsWith('_'));
  const names = report.columns.map((c) => c.name).filter((n) => n.trim() !== '');

  const add = (col: ReportColumn) => update((r) => void r.report.columns.push(col));
  const firstMoney = all.find((c) => c.type === 'money') ?? all.find((c) => c.type === 'number');
  const unshownGroup = report.groupBy.find((g) => !report.columns.some((c) => c.kind === 'group' && c.from === g));

  const result = preview.result;
  const reportResult = result?.report ?? null;
  const issues = result ? result.issues.filter((i) => i.level !== 'info') : [];

  return (
    <div className="space-y-8">
      <section className="space-y-3" aria-labelledby="group-h">
        <div>
          <h2 id="group-h" className="text-lg font-medium">
            One row for each…
          </h2>
          <p className="text-sm text-muted-foreground">Pick what the report is grouped by, for example Doctor, Department and Month. Rows with the same values are added together.</p>
        </div>
        <ul className="space-y-2">
          {report.groupBy.map((g, i) => (
            <li key={g} className="flex items-center gap-2 rounded-lg border p-2">
              <span className="flex-1 pl-1 text-sm font-medium">{g}</span>
              <Button variant="ghost" size="icon" aria-label={`Move ${g} up`} disabled={i === 0} onClick={() => update((r) => move(r.report.groupBy, i, -1))}>
                <ArrowUp className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Move ${g} down`} disabled={i === report.groupBy.length - 1} onClick={() => update((r) => move(r.report.groupBy, i, 1))}>
                <ArrowDown className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Stop grouping by ${g}`} onClick={() => update((r) => void r.report.groupBy.splice(i, 1))}>
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <label className="block max-w-sm space-y-1 text-sm">
          <span className="font-medium">Add a column to group by</span>
          <NativeSelect
            value=""
            onChange={(e) => {
              const name = e.target.value;
              if (name) update((r) => void r.report.groupBy.push(name));
            }}
          >
            <option value="">Choose…</option>
            {free.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        {report.groupBy.length === 0 && <p className="text-xs text-muted-foreground">With nothing chosen the report is a single row of totals.</p>}
      </section>

      <section className="space-y-3" aria-labelledby="cols-h">
        <div>
          <h2 id="cols-h" className="text-lg font-medium">
            Report columns
          </h2>
          <p className="text-sm text-muted-foreground">In the order they appear. Use the headings of your Excel template if you will fill one.</p>
        </div>
        {report.columns.map((_, i) => (
          <ReportColumnCard key={i} index={i} total={report.columns.length} />
        ))}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => add({ kind: 'serial', name: 'S.No.' })}>
            <Hash className="size-4" /> Row number
          </Button>
          <Button variant="outline" size="sm" disabled={report.groupBy.length === 0} onClick={() => add({ kind: 'group', name: unshownGroup ?? report.groupBy[0] ?? '', from: unshownGroup ?? report.groupBy[0] ?? '' })}>
            <Users className="size-4" /> Group name
          </Button>
          <Button variant="outline" size="sm" onClick={() => add({ kind: 'aggregate', name: 'New total', agg: 'SUM', of: firstMoney?.name, type: aggregateType('SUM', firstMoney?.type) })}>
            <Sigma className="size-4" /> Total
          </Button>
          <Button variant="outline" size="sm" onClick={() => add({ kind: 'formula', name: 'New formula', formula: '', type: 'money' })}>
            <Sparkles className="size-4" /> Formula
          </Button>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="sort-h">
        <h2 id="sort-h" className="text-lg font-medium">
          Order and totals
        </h2>
        <p className="text-sm text-muted-foreground">
          {report.sort === undefined ? 'Rows are in A–Z order of the “one row for each” columns.' : report.sort.length === 0 ? 'Rows stay in the order they were found.' : 'Rows are sorted as below.'}
        </p>
        <div className="space-y-2">
          {(report.sort ?? []).map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_9rem_auto] gap-2">
              <NativeSelect value={s.column} onChange={(e) => update((r) => void ((r.report.sort as NonNullable<typeof r.report.sort>)[i]!.column = e.target.value))} aria-label="Sort by">
                {!names.includes(s.column) && <option value={s.column}>{s.column || 'Choose…'}</option>}
                {names.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect value={s.dir} onChange={(e) => update((r) => void ((r.report.sort as NonNullable<typeof r.report.sort>)[i]!.dir = e.target.value as 'asc' | 'desc'))} aria-label="Direction">
                <option value="asc">Small to large</option>
                <option value="desc">Large to small</option>
              </NativeSelect>
              <Button variant="ghost" size="icon" aria-label="Remove this sort" onClick={() => update((r) => void r.report.sort?.splice(i, 1))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" disabled={names.length === 0} onClick={() => update((r) => void (r.report.sort = [...(r.report.sort ?? []), { column: names[0] ?? '', dir: 'desc' }]))}>
            <Plus className="size-4" /> Sort by a column
          </Button>
          {report.sort !== undefined && (
            <Button variant="ghost" size="sm" onClick={() => update((r) => void (r.report.sort = undefined))}>
              Back to A–Z
            </Button>
          )}
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input type="checkbox" className="size-5 accent-primary" checked={report.totalsRow} onChange={(e) => update((r) => void (r.report.totalsRow = e.target.checked))} />
            Add a totals row
          </label>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="preview-h">
        <div>
          <h2 id="preview-h" className="text-lg font-medium">
            Preview
          </h2>
          <p className="text-sm text-muted-foreground">Built from your sample files. {preview.running && 'Updating…'}</p>
        </div>
        {!hasSamples && <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Add sample files in 1 Sources to see the report here.</p>}
        {preview.error && (
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {preview.error}
          </p>
        )}
        <IssueList issues={issues} />
        {reportResult && reportResult.columns.length > 0 && (
          <>
            <p className="text-sm text-muted-foreground">
              {reportResult.rows.length.toLocaleString('en-IN')} rows from {reportResult.inputRows.toLocaleString('en-IN')} combined rows.
            </p>
            <ReportGrid columns={reportResult.columns} rows={reportResult.rows} totals={reportResult.totals} />
          </>
        )}
      </section>
    </div>
  );
}
