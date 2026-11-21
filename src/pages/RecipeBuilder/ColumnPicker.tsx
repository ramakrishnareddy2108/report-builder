import { Lock } from 'lucide-react';
import { useId, useMemo } from 'react';
import { NativeSelect } from '@/components/NativeSelect';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { columnLetter } from '@/excel/detectHeader';
import { isPatientColumn } from '@/excel/patient';
import { ColumnIndex } from '@/formula';
import type { ColumnType, SourceDef } from '@/recipe/schema';
import type { Sample } from './sample';
import { fromFor, pickableColumns, pickedColumn } from './sourceFactory';

const TYPES: { value: ColumnType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'money', label: 'Money (₹)' },
  { value: 'date', label: 'Date' },
];

type Props = {
  source: SourceDef;
  sample: Sample;
  /** Names used in other sources, for autocomplete (so stacking lines up). */
  nameSuggestions: readonly string[];
  otherSources: readonly SourceDef[];
  onChange: (columns: SourceDef['columns']) => void;
};

function shown(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

/** Tick the columns you need, give them a common name and a type. */
export function ColumnPicker({ source, sample, nameSuggestions, otherSources, onChange }: Props) {
  const listId = useId();
  const index = useMemo(() => new ColumnIndex(sample.headers), [sample.headers]);

  // which sample column each picked column points at
  const picked = useMemo(() => {
    const byIndex = new Map<number, number>(); // header index → position in source.columns
    const missing: number[] = [];
    source.columns.forEach((c, pos) => {
      const i = index.find(c.from);
      if (i === null) missing.push(pos);
      else if (!byIndex.has(i)) byIndex.set(i, pos);
    });
    return { byIndex, missing };
  }, [source.columns, index]);

  function toggle(i: number) {
    const pos = picked.byIndex.get(i);
    if (pos !== undefined) return onChange(source.columns.filter((_, p) => p !== pos));
    onChange([...source.columns, pickedColumn(sample, i, otherSources)]);
  }

  function selectAll() {
    onChange([...source.columns, ...pickableColumns(sample, new Set(picked.byIndex.keys())).map((i) => pickedColumn(sample, i, otherSources))]);
  }

  const patch = (pos: number, change: Partial<SourceDef['columns'][number]>) => onChange(source.columns.map((c, p) => (p === pos ? { ...c, ...change } : c)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {source.columns.length} of {sample.headers.length} columns picked
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={selectAll}>
            Pick all
          </Button>
          <Button size="sm" variant="outline" onClick={() => onChange([])} disabled={source.columns.length === 0}>
            Clear
          </Button>
        </div>
      </div>

      {picked.missing.length > 0 && (
        <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">These columns are not in this file any more. Pick the new column for each.</p>
          {picked.missing.map((pos) => {
            const c = source.columns[pos] as SourceDef['columns'][number];
            return (
              <div key={`${c.from}-${pos}`} className="flex flex-wrap items-center gap-2">
                <span className="min-w-32">
                  {c.from} <span className="text-muted-foreground">→ {c.as}</span>
                </span>
                <NativeSelect className="w-auto max-w-full flex-1" value="" onChange={(e) => e.target.value !== '' && patch(pos, { from: e.target.value })} aria-label={`New column for ${c.from}`}>
                  <option value="">Choose the new column…</option>
                  {sample.headers.map((h, i) => (
                    <option key={h} value={fromFor(sample, i)} disabled={isPatientColumn(sample.rawHeaders[i] ?? h)}>
                      {columnLetter(i)} · {h}
                    </option>
                  ))}
                </NativeSelect>
                <Button size="sm" variant="ghost" onClick={() => onChange(source.columns.filter((_, p) => p !== pos))}>
                  Remove
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <datalist id={listId}>
        {nameSuggestions.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <ul className="divide-y rounded-lg border">
        {sample.headers.map((header, i) => {
          const pos = picked.byIndex.get(i);
          const on = pos !== undefined;
          const patient = isPatientColumn(sample.rawHeaders[i] ?? header);
          const example = sample.rows.map((r) => shown(r[i])).find((v) => v !== '') ?? '';
          const col = on ? (source.columns[pos] as SourceDef['columns'][number]) : null;
          return (
            <li key={`${i}-${header}`} className="space-y-2 p-2.5">
              <label className="flex min-h-10 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-primary"
                  checked={on}
                  disabled={patient}
                  onChange={() => toggle(i)}
                  aria-label={`Use column ${columnLetter(i)} ${header}`}
                />
                <span className="w-8 shrink-0 text-xs text-muted-foreground">{columnLetter(i)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{header}</span>
                  {example !== '' && <span className="block truncate text-xs text-muted-foreground">e.g. {example}</span>}
                </span>
                {patient && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground" title="Patient details are never read into the app">
                    <Lock className="size-3.5" aria-hidden /> patient data
                  </span>
                )}
              </label>
              {col && pos !== undefined && (
                <div className="grid gap-2 pl-8 sm:grid-cols-[1fr_10rem]">
                  <Input
                    list={listId}
                    value={col.as}
                    onChange={(e) => patch(pos, { as: e.target.value })}
                    aria-label={`Save ${header} as`}
                    placeholder="Save as…"
                    aria-invalid={col.as.trim() === ''}
                  />
                  <NativeSelect value={col.type} onChange={(e) => patch(pos, { type: e.target.value as ColumnType })} aria-label={`Type of ${header}`}>
                    {TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
