import { ChevronDown, ChevronRight, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FileDrop } from '@/components/FileDrop';
import { FormulaField, type FormulaExample } from '@/components/FormulaField';
import { NativeSelect } from '@/components/NativeSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ColumnIndex } from '@/formula';
import { autoRequiredHeaders, usedNames } from '@/recipe/guess';
import type { ColumnType, SourceDef } from '@/recipe/schema';
import { useBuilder } from './builderStore';
import { ColumnPicker } from './ColumnPicker';
import { loadSample } from './sample';
import { SamplePreview } from './SamplePreview';

const TYPES: { value: ColumnType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'money', label: 'Money (₹)' },
  { value: 'date', label: 'Date' },
];

/** Ready-made row filters, using this file's own first column so they work as they are. */
function filterExamples(headers: readonly string[]): FormulaExample[] {
  const first = headers[0];
  if (!first) return [];
  return [
    { label: `Drop the totals row (keep rows where ${first} is filled)`, formula: `NOT(ISBLANK([${first}]))` },
    { label: `Keep only rows where ${first} is empty`, formula: `ISBLANK([${first}])` },
    { label: 'Keep one value only (edit the column and text)', formula: `[${first}]="VALUE"` },
  ];
}

/** Ready-made calculated columns from the money / number columns picked. */
function calcExamples(numeric: readonly string[]): FormulaExample[] {
  const [a, b] = numeric;
  if (!a) return [{ label: 'Count 1 for every row', formula: '1' }];
  const out: FormulaExample[] = [{ label: 'Count 1 for every row', formula: '1' }, { label: `Make ${a} negative (e.g. returns)`, formula: `-[${a}]` }];
  if (b) out.unshift({ label: `${a} minus ${b} (e.g. gross − concession)`, formula: `[${a}]-[${b}]` }, { label: `${a} plus ${b}`, formula: `[${a}]+[${b}]` });
  return out;
}

const sameList =(a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="space-y-2">
      <div>
        <h4 className="text-sm font-semibold">{title}</h4>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function SourceCard({ sourceId, startOpen = false }: { sourceId: string; startOpen?: boolean }) {
  const recipe = useBuilder((s) => s.recipe);
  const sample = useBuilder((s) => s.samples[sourceId]);
  const update = useBuilder((s) => s.update);
  const setSample = useBuilder((s) => s.setSample);
  const reloadSample = useBuilder((s) => s.reloadSample);
  const removeSample = useBuilder((s) => s.removeSample);

  const focused = useBuilder((s) => s.focusSource === sourceId);
  const [open, setOpen] = useState(startOpen || focused);
  const [showPreview, setShowPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const source = recipe?.sources.find((s) => s.id === sourceId);
  const index = useMemo(() => (sample ? new ColumnIndex(sample.headers) : null), [sample]);
  if (!recipe || !source) return null;

  const others = recipe.sources.filter((s) => s.id !== sourceId);
  const edit = (fn: (s: SourceDef) => void) =>
    update((r) => {
      const s = r.sources.find((x) => x.id === sourceId);
      if (s) fn(s);
    });

  /** Change the picked columns, and keep "how to recognise this file" in step while it is still automatic. */
  const setColumns = (columns: SourceDef['columns']) =>
    edit((s) => {
      const wasAuto = sameList(s.match.requiredHeaders, autoRequiredHeaders(s));
      s.columns = columns;
      if (wasAuto) s.match.requiredHeaders = autoRequiredHeaders(s);
      if (s.uniqueColumn && ![...s.columns.map((c) => c.as), ...s.calculated.map((c) => c.as)].some((n) => n.toUpperCase() === s.uniqueColumn?.toUpperCase())) {
        s.uniqueColumn = undefined;
      }
    });

  const renamed = [...source.columns.map((c) => c.as), ...source.calculated.map((c) => c.as)];
  const originals = sample?.headers ?? [];
  const originalExists = (n: string) => index?.find(n) != null;

  async function replaceSample(files: File[]) {
    const file = files[0];
    if (!file || !source) return;
    try {
      const { sample: next } = await loadSample(file, { sheet: source.sheet.name, headerRow: source.headerRow });
      setSample(sourceId, next);
      toast.success(`Using ${file.name} as the sample for ${source.label}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That file could not be read.');
    }
  }

  const missing = source.columns.filter((c) => index && index.find(c.from) === null).length;

  return (
    <Card>
      <CardContent className="space-y-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 text-left focus-visible:outline-none"
        >
          {open ? <ChevronDown className="size-5 shrink-0" aria-hidden /> : <ChevronRight className="size-5 shrink-0" aria-hidden />}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{source.label || '(no name)'}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {source.columns.length} column{source.columns.length === 1 ? '' : 's'} picked · {sample ? sample.file.name : 'no sample file in this session'}
            </span>
          </span>
          {missing > 0 && (
            <Badge variant="destructive" className="gap-1">
              <TriangleAlert className="size-3" aria-hidden /> {missing} missing
            </Badge>
          )}
          <Badge variant={source.required ? 'default' : 'secondary'}>{source.required ? 'Required' : 'Optional'}</Badge>
        </button>

        {open && (
          <div className="space-y-6">
            <Section title="Basics">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Name of this source</span>
                  <Input value={source.label} onChange={(e) => edit((s) => (s.label = e.target.value))} placeholder="e.g. OP Billing" aria-invalid={source.label.trim() === ''} />
                </label>
                <label className="flex min-h-10 items-center gap-3 text-sm sm:pt-6">
                  <input type="checkbox" className="size-5 accent-primary" checked={source.required} onChange={(e) => edit((s) => (s.required = e.target.checked))} />
                  <span>
                    <b>Required</b>
                    <span className="block text-xs text-muted-foreground">The report cannot be made without this file.</span>
                  </span>
                </label>
              </div>
            </Section>

            {!sample ? (
              <FileDrop multiple={false} compact title="Add a sample file" hint="Pick this source's Excel file to choose columns and test formulas. It is not saved." onFiles={(f) => void replaceSample(f)} />
            ) : (
              <>
                <Section title="Which part of the file?" hint={`${sample.file.name} · ${sample.sheetRowCount.toLocaleString('en-IN')} rows in this sheet`}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-sm">
                      <span className="font-medium">Sheet</span>
                      <NativeSelect
                        value={source.sheet.name ?? sample.sheet ?? ''}
                        onChange={(e) => {
                          const name = e.target.value;
                          edit((s) => (s.sheet = { name }));
                          void reloadSample(sourceId, { sheet: name, headerRow: source.headerRow });
                        }}
                      >
                        {sample.sheets.map((s) => (
                          <option key={s.name} value={s.name}>
                            {s.name} ({s.rowCount.toLocaleString('en-IN')} rows)
                          </option>
                        ))}
                      </NativeSelect>
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="font-medium">Header row</span>
                      <div className="flex gap-2">
                        <NativeSelect
                          className="w-32"
                          value={source.headerRow === 'auto' ? 'auto' : 'row'}
                          onChange={(e) => {
                            const headerRow = e.target.value === 'auto' ? ('auto' as const) : (sample.headerRow ?? 1);
                            edit((s) => (s.headerRow = headerRow));
                            void reloadSample(sourceId, { sheet: source.sheet.name, headerRow });
                          }}
                          aria-label="How the header row is found"
                        >
                          <option value="auto">Auto-detect</option>
                          <option value="row">Row number</option>
                        </NativeSelect>
                        {source.headerRow !== 'auto' && (
                          <Input
                            type="number"
                            min={1}
                            className="w-24"
                            value={source.headerRow}
                            aria-label="Header row number"
                            onChange={(e) => {
                              const n = Math.max(1, Math.floor(Number(e.target.value) || 1));
                              edit((s) => (s.headerRow = n));
                              void reloadSample(sourceId, { sheet: source.sheet.name, headerRow: n });
                            }}
                          />
                        )}
                      </div>
                      <span className="block text-xs text-muted-foreground">
                        {sample.headerRow ? `Header found on row ${sample.headerRow}.` : 'No header found.'}
                      </span>
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setShowPreview((v) => !v)}>
                      {showPreview ? 'Hide preview' : 'Show first 50 rows'}
                    </Button>
                    <FileDrop multiple={false} compact title="Use another file" hint="" onFiles={(f) => void replaceSample(f)} />
                  </div>
                  {showPreview && <SamplePreview sample={sample} />}
                </Section>

                <Section title="Columns to use" hint="Tick what the report needs, give each a common name (the same name in every source stacks together) and a type.">
                  <ColumnPicker source={source} sample={sample} nameSuggestions={usedNames(others)} otherSources={others} onChange={setColumns} />
                </Section>
              </>
            )}

            <Section title="Leave out some rows" hint="Optional. A formula over the file's own column names; rows where it is TRUE are kept. Totals rows at the bottom are usually removed this way.">
              <FormulaField
                label="Keep a row when"
                value={source.rowFilter ?? ''}
                onChange={(v) => edit((s) => (s.rowFilter = v === '' ? undefined : v))}
                columns={originals}
                columnsLabel="Columns in this file"
                columnExists={index ? originalExists : undefined}
                placeholder="NOT(ISBLANK([BILLNO]))"
                examples={filterExamples(originals)}
                optional
                hint={sample ? 'Leave empty to keep every row.' : 'Add a sample file to check the column names.'}
              />
            </Section>

            <Section title="Calculated columns" hint="New columns worked out from the others, for example Amount = [GROSSAMOUNT]-[CONCESSION].">
              <div className="space-y-4">
                {source.calculated.map((c, i) => {
                  const earlier = new Set([...source.columns.map((x) => x.as), ...source.calculated.slice(0, i).map((x) => x.as)].map((n) => n.toUpperCase()));
                  return (
                    <div key={i} className="space-y-3 rounded-lg border p-3">
                      <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
                        <Input value={c.as} onChange={(e) => edit((s) => ((s.calculated[i] as SourceDef['calculated'][number]).as = e.target.value))} placeholder="Column name, e.g. Amount" aria-label="Calculated column name" aria-invalid={c.as.trim() === ''} />
                        <NativeSelect value={c.type} onChange={(e) => edit((s) => ((s.calculated[i] as SourceDef['calculated'][number]).type = e.target.value as ColumnType))} aria-label="Type">
                          {TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </NativeSelect>
                        <Button variant="ghost" size="icon" aria-label={`Remove ${c.as || 'calculated column'}`} onClick={() => edit((s) => s.calculated.splice(i, 1))}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      <FormulaField
                        label="Formula"
                        value={c.formula}
                        onChange={(v) => edit((s) => ((s.calculated[i] as SourceDef['calculated'][number]).formula = v))}
                        columns={[...new Set([...renamed.filter((n) => earlier.has(n.toUpperCase())), ...originals])]}
                        columnsLabel="Columns in this file, and names you gave above"
                        columnExists={index ? (n) => earlier.has(n.toUpperCase()) || originalExists(n) : (n) => earlier.has(n.toUpperCase())}
                        placeholder="[GROSSAMOUNT]-[CONCESSION]"
                        examples={calcExamples(source.columns.filter((x) => x.type === 'money' || x.type === 'number').map((x) => x.as))}
                      />
                    </div>
                  );
                })}
                <Button variant="outline" size="sm" onClick={() => edit((s) => s.calculated.push({ as: '', formula: '', type: 'money' }))}>
                  <Plus className="size-4" /> Add a calculated column
                </Button>
              </div>
            </Section>

            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-semibold">Advanced: recognising the file, repeated numbers</summary>
              <div className="mt-3 space-y-4">
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">File name contains</span>
                  <Input value={source.match.namePattern ?? ''} onChange={(e) => edit((s) => (s.match.namePattern = e.target.value))} placeholder="e.g. OP Billing Report" />
                  <span className="block text-xs text-muted-foreground">Months, years and dates in the real file name are ignored.</span>
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">Columns the file must have (one per line)</span>
                  <textarea
                    rows={4}
                    value={source.match.requiredHeaders.join('\n')}
                    onChange={(e) => edit((s) => (s.match.requiredHeaders = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean)))}
                    className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 font-mono text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
                  />
                  <span className="block text-xs text-muted-foreground">Filled in from the columns you pick. Used to find the right file when you generate.</span>
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">Warn when this column repeats</span>
                  <NativeSelect value={source.uniqueColumn ?? ''} onChange={(e) => edit((s) => (s.uniqueColumn = e.target.value || undefined))}>
                    <option value="">Do not check (for files with one line per item)</option>
                    {renamed.filter((n) => n.trim() !== '').map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              </div>
            </details>

            <div className="flex justify-end border-t pt-3">
              <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" /> Remove this source
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmDelete}
        title={`Remove “${source.label}”?`}
        description="Its columns, row filter and calculated columns are removed from this recipe. Lookups or report columns that use it will need fixing."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          update((r) => void (r.sources = r.sources.filter((s) => s.id !== sourceId)));
          removeSample(sourceId);
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </Card>
  );
}
