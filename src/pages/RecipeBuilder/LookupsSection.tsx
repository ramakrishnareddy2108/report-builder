import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FormulaField } from '@/components/FormulaField';
import { NativeSelect } from '@/components/NativeSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatINR } from '@/core/money';
import type { LookupResult } from '@/engine/lookups';
import { combinedColumns } from '@/recipe/columns';
import { DEFAULT_TIE_BREAK_FORMULA, type LookupRule, type Recipe } from '@/recipe/schema';
import { useBuilder } from './builderStore';

/** The common names a source gives its columns (renamed and calculated). */
function sourceColumns(recipe: Recipe, sourceId: string): string[] {
  const s = recipe.sources.find((x) => x.id === sourceId);
  return s ? [...s.columns.map((c) => c.as), ...s.calculated.map((c) => c.as)].filter((n) => n.trim() !== '') : [];
}

const NEW_LOOKUP = (recipe: Recipe): LookupRule => {
  const [target, from] = [recipe.sources[0]?.id ?? '', recipe.sources[1]?.id ?? recipe.sources[0]?.id ?? ''];
  return {
    label: 'New lookup',
    target: { source: target, column: 'Doctor', key: '' },
    from: { source: from, key: '', value: '' },
    pick: 'latestOnOrBefore',
    notFoundValue: 'Unattributed',
    writeStatusColumn: 'Attribution',
  };
};

function Pick({ label, value, options, onChange, optional, hint }: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void; optional?: boolean; hint?: string }) {
  const missing = value !== '' && !options.includes(value);
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!optional && value === ''}>
        <option value="">{optional ? '(none)' : 'Choose…'}</option>
        {missing && <option value={value}>{value} (not found)</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </NativeSelect>
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Summary({ result }: { result: LookupResult | undefined }) {
  if (!result) return <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">The result appears here when a sample file is added and the lookup is complete.</p>;
  const money = (s: keyof LookupResult['byStatus']) => (result.amountColumn ? ` · ${formatINR(result.amountByStatus[s])}` : '');
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm" aria-live="polite">
      <p className="font-medium">{result.considered.toLocaleString('en-IN')} rows looked up</p>
      <div className="flex flex-wrap gap-2">
        <Badge>Matched {result.byStatus.Matched.toLocaleString('en-IN')}{money('Matched')}</Badge>
        <Badge variant="secondary">Nearest record {result.byStatus.Fallback.toLocaleString('en-IN')}{money('Fallback')}</Badge>
        <Badge variant={result.byStatus.Ambiguous > 0 ? 'destructive' : 'secondary'}>Ambiguous {result.byStatus.Ambiguous.toLocaleString('en-IN')}{money('Ambiguous')}</Badge>
        <Badge variant={result.byStatus.Unattributed > 0 ? 'destructive' : 'secondary'}>Not found {result.byStatus.Unattributed.toLocaleString('en-IN')}{money('Unattributed')}</Badge>
      </div>
      {result.skipped > 0 && <p className="text-xs text-muted-foreground">{result.skipped.toLocaleString('en-IN')} rows skipped by the “only when” rule.</p>}
      {result.ambiguousExamples.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {result.ambiguousExamples.slice(0, 5).map((a, i) => (
            <li key={i}>
              Tie, for example: {a.key}{a.day ? ` on ${a.day}` : ''} has {a.values.join(' and ')}; written: {a.written}
            </li>
          ))}
        </ul>
      )}
      {result.notFoundKeys.length > 0 && <p className="text-xs text-muted-foreground">Not found, for example: {result.notFoundKeys.join(', ')}</p>}
    </div>
  );
}

function LookupCard({ index, result }: { index: number; result: LookupResult | undefined }) {
  const recipe = useBuilder((s) => s.recipe);
  const update = useBuilder((s) => s.update);
  const [confirm, setConfirm] = useState(false);
  const rule = recipe?.lookups[index];
  if (!recipe || !rule) return null;
  const patch = (fn: (r: LookupRule) => void) => update((r) => void fn(r.lookups[index] as LookupRule));

  const sources = recipe.sources.map((s) => ({ id: s.id, label: s.label }));
  const all = combinedColumns(recipe).map((c) => c.name);
  const targetCols = sourceColumns(recipe, rule.target.source);
  const fromCols = sourceColumns(recipe, rule.from.source);
  const needsDates = rule.pick === 'latestOnOrBefore';

  const SourceSelect = ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
    <label className="space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)}>
        {!sources.some((s) => s.id === value) && <option value={value}>{value || 'Choose…'}</option>}
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </NativeSelect>
    </label>
  );

  return (
    <div className="space-y-4 rounded-lg border p-3">
      <div className="flex items-end gap-3">
        <label className="flex-1 space-y-1 text-sm">
          <span className="font-medium">Name of this lookup</span>
          <Input value={rule.label} onChange={(e) => patch((r) => (r.label = e.target.value))} aria-invalid={rule.label.trim() === ''} />
        </label>
        <Button variant="ghost" size="icon" aria-label={`Remove ${rule.label}`} onClick={() => setConfirm(true)}>
          <Trash2 className="size-4" />
        </Button>
      </div>

      <fieldset className="space-y-3 rounded-lg bg-muted/20 p-3">
        <legend className="px-1 text-sm font-semibold">Fill in missing values on…</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <SourceSelect label="This source" value={rule.target.source} onChange={(v) => patch((r) => (r.target.source = v))} />
          <label className="space-y-1 text-sm">
            <span className="font-medium">This column</span>
            <Input list="all-columns" value={rule.target.column} onChange={(e) => patch((r) => (r.target.column = e.target.value))} placeholder="e.g. Doctor" />
          </label>
          <Pick label="Matched by (key)" value={rule.target.key} options={targetCols} onChange={(v) => patch((r) => (r.target.key = v))} hint="e.g. UMRNO" />
          {needsDates && <Pick label="On or before this date" value={rule.target.date ?? ''} options={targetCols} onChange={(v) => patch((r) => (r.target.date = v || undefined))} />}
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg bg-muted/20 p-3">
        <legend className="px-1 text-sm font-semibold">…using values from</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <SourceSelect label="This source" value={rule.from.source} onChange={(v) => patch((r) => (r.from.source = v))} />
          <Pick label="Same key" value={rule.from.key} options={fromCols} onChange={(v) => patch((r) => (r.from.key = v))} />
          <Pick label="Take the value from" value={rule.from.value} options={fromCols} onChange={(v) => patch((r) => (r.from.value = v))} hint="e.g. Doctor" />
          {needsDates && <Pick label="Record date" value={rule.from.date ?? ''} options={fromCols} onChange={(v) => patch((r) => (r.from.date = v || undefined))} />}
        </div>

        <div className="space-y-2">
          <h5 className="text-sm font-medium">Also bring over (optional)</h5>
          {(rule.from.extraValues ?? []).map((e, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <NativeSelect value={e.from} onChange={(ev) => patch((r) => ((r.from.extraValues as NonNullable<LookupRule['from']['extraValues']>)[i]!.from = ev.target.value))} aria-label="Column to bring over">
                <option value="">Choose…</option>
                {fromCols.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
              <Input value={e.as} onChange={(ev) => patch((r) => ((r.from.extraValues as NonNullable<LookupRule['from']['extraValues']>)[i]!.as = ev.target.value))} placeholder="Fill this column, e.g. Department" aria-label="Column to fill" list="all-columns" />
              <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => patch((r) => void r.from.extraValues?.splice(i, 1))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => patch((r) => void (r.from.extraValues = [...(r.from.extraValues ?? []), { from: '', as: '' }]))}>
            <Plus className="size-4" /> Bring another column
          </Button>
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Which record to use</span>
          <NativeSelect value={rule.pick} onChange={(e) => patch((r) => (r.pick = e.target.value as LookupRule['pick']))}>
            <option value="latestOnOrBefore">The latest one on or before the row&apos;s date</option>
            <option value="first">The first one in the file</option>
            <option value="single">The only one (flag it if they disagree)</option>
          </NativeSelect>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">If nothing is found, write</span>
          <Input value={rule.notFoundValue} onChange={(e) => patch((r) => (r.notFoundValue = e.target.value))} placeholder="e.g. Pharmacy – Unattributed" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Note how it was found in column (optional)</span>
          <Input value={rule.writeStatusColumn ?? ''} onChange={(e) => patch((r) => (r.writeStatusColumn = e.target.value || undefined))} placeholder="e.g. Attribution" />
          <span className="block text-xs text-muted-foreground">Writes Matched, Fallback, Ambiguous or Unattributed.</span>
        </label>
      </div>

      {needsDates && (
        <fieldset className="space-y-3 rounded-lg bg-muted/20 p-3">
          <legend className="px-1 text-sm font-semibold">When one day has different values</legend>
          <p className="text-xs text-muted-foreground">
            For example, two consultations on the same day with two different doctors. These rows are marked Ambiguous and counted in the Checks. Matched means the day has only one value.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Which one to write</span>
              <NativeSelect
                value={rule.tieBreak?.method ?? 'first'}
                onChange={(e) =>
                  patch((r) => {
                    const method = e.target.value as NonNullable<LookupRule['tieBreak']>['method'];
                    r.tieBreak = { method, then: r.tieBreak?.then ?? 'first', preferFormula: method === 'preferNotMatching' ? r.tieBreak?.preferFormula || DEFAULT_TIE_BREAK_FORMULA : r.tieBreak?.preferFormula };
                  })
                }
              >
                <option value="preferNotMatching">Prefer the records where a formula is true</option>
                <option value="first">The first one in the file</option>
                <option value="unattributed">None: write the “not found” value</option>
              </NativeSelect>
            </label>
            {rule.tieBreak?.method === 'preferNotMatching' && (
              <label className="space-y-1 text-sm">
                <span className="font-medium">If that does not leave one value</span>
                <NativeSelect value={rule.tieBreak.then} onChange={(e) => patch((r) => void (r.tieBreak && (r.tieBreak.then = e.target.value as 'first' | 'unattributed')))}>
                  <option value="first">Use the first one</option>
                  <option value="unattributed">Write the “not found” value</option>
                </NativeSelect>
              </label>
            )}
          </div>
          {rule.tieBreak?.method === 'preferNotMatching' && (
            <FormulaField
              label="Prefer a record when"
              value={rule.tieBreak.preferFormula ?? ''}
              onChange={(v) => patch((r) => void (r.tieBreak && (r.tieBreak.preferFormula = v)))}
              columns={fromCols}
              columnExists={(n) => all.some((c) => c.toUpperCase() === n.toUpperCase())}
              placeholder={DEFAULT_TIE_BREAK_FORMULA}
              hint="Checked on each tied record of the lookup source. Leave empty to use the standard test: not a “Consultation” or “Check Up” entry."
              optional
            />
          )}
        </fieldset>
      )}

      <FormulaField
        label="Only for rows where (optional)"
        value={rule.onlyWhen ?? ''}
        onChange={(v) => patch((r) => (r.onlyWhen = v === '' ? undefined : v))}
        columns={targetCols}
        columnExists={(n) => all.some((c) => c.toUpperCase() === n.toUpperCase())}
        placeholder="ISBLANK([AdmissionNo])"
        hint="Leave empty to look up every row of the source."
        optional
      />

      <Summary result={result} />

      <ConfirmDialog
        open={confirm}
        title={`Remove “${rule.label}”?`}
        description="Rows will no longer be filled in by this lookup."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          update((r) => void r.lookups.splice(index, 1));
          setConfirm(false);
        }}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}

export function LookupsSection({ results }: { results: readonly LookupResult[] | undefined }) {
  const recipe = useBuilder((s) => s.recipe);
  const update = useBuilder((s) => s.update);
  if (!recipe) return null;
  const names = combinedColumns(recipe).map((c) => c.name);

  return (
    <section className="space-y-3" aria-labelledby="lookups-h">
      <div>
        <h2 id="lookups-h" className="text-lg font-medium">
          Look up missing values
        </h2>
        <p className="text-sm text-muted-foreground">
          Some files lack a value that another file has: for example, pharmacy sales have no doctor, but the same patient&apos;s consultation does. A lookup copies it across, and counts every row it could not match.
        </p>
      </div>
      <datalist id="all-columns">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {recipe.lookups.map((l, i) => (
        <LookupCard key={i} index={i} result={results?.find((r) => r.label === l.label)} />
      ))}
      <Button variant="outline" size="sm" disabled={recipe.sources.length === 0} onClick={() => update((r) => void r.lookups.push(NEW_LOOKUP(r)))}>
        <Plus className="size-4" /> Add a lookup
      </Button>
      {recipe.sources.length === 0 && <p className="text-sm text-muted-foreground">Add sources first.</p>}
    </section>
  );
}
