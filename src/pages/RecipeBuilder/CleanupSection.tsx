import { Merge, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { NativeSelect } from '@/components/NativeSelect';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { CleanupReport, CleanupStep } from '@/engine/cleanup';
import { combinedColumns } from '@/recipe/columns';
import type { CleanupRule } from '@/recipe/schema';
import { useBuilder } from './builderStore';

const NEW_RULE = (column: string): CleanupRule => ({
  column,
  normalize: { trim: true, collapseSpaces: true, ignoreCase: true, removeChars: ',', dotsToSpace: true },
  displayCase: 'title',
  aliases: [],
});

type NameRow = { name: string; count: number; spellings: string[] };

const STEP_LABEL: Record<CleanupStep, string> = { dots: 'dots became spaces', prefix: '“Dr” removed', suffix: 'ending removed' };

/** One cleanup rule: options, a live list of the names it produces, and merging of names that are the same. */
function RuleCard({ index, report, running }: { index: number; report: CleanupReport | undefined; running: boolean }) {
  const rule = useBuilder((s) => s.recipe?.cleanup[index]);
  const update = useBuilder((s) => s.update);
  // Select the stored recipe (a stable reference) and derive the list here. A selector that builds a new
  // array on every call makes zustand 5 re-render forever ("Maximum update depth exceeded").
  const recipe = useBuilder((s) => s.recipe);
  const columns = useMemo(() => (recipe ? combinedColumns(recipe).filter((c) => c.type === 'text') : []), [recipe]);
  const [selected, setSelected] = useState<string[]>([]);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [target, setTarget] = useState('');
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [allAffected, setAllAffected] = useState(false);

  const names = useMemo<NameRow[]>(() => {
    const byName = new Map<string, NameRow>();
    for (const v of report?.values ?? []) {
      const row = byName.get(v.clean) ?? { name: v.clean, count: 0, spellings: [] };
      row.count += v.count;
      if (!row.spellings.includes(v.raw)) row.spellings.push(v.raw);
      byName.set(v.clean, row);
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [report]);

  // the spellings that dots / “Dr” / the ending changed, most used first
  const affected = useMemo(() => (report?.values ?? []).filter((v) => (v.steps?.length ?? 0) > 0).sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw)), [report]);

  if (!rule) return null;
  const patch = (fn: (r: CleanupRule) => void) => update((r) => void fn(r.cleanup[index] as CleanupRule));

  const visible = names.filter((n) => query.trim() === '' || n.name.toLowerCase().includes(query.toLowerCase()) || n.spellings.some((s) => s.toLowerCase().includes(query.toLowerCase())));
  const shown = all ? visible : visible.slice(0, 60);
  const countOf = (name: string) => names.find((n) => n.name === name)?.count ?? 0;

  function openMerge(list: string[]) {
    const best = [...list].sort((a, b) => countOf(b) - countOf(a))[0] ?? '';
    setSelected(list);
    setTarget(best);
    setMergeOpen(true);
  }

  function doMerge() {
    const to = target.trim();
    if (to === '') return;
    patch((r) => {
      const existing = r.aliases.find((a) => a.to === to);
      const from = selected.filter((n) => n !== to);
      if (existing) existing.from = [...new Set([...existing.from, ...from])];
      else r.aliases.push({ to, from });
    });
    setSelected([]);
    setMergeOpen(false);
  }

  return (
    <div className="space-y-4 rounded-lg border p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-40 flex-1 space-y-1 text-sm">
          <span className="font-medium">Column to clean</span>
          <NativeSelect value={rule.column} onChange={(e) => patch((r) => (r.column = e.target.value))}>
            {!columns.some((c) => c.name === rule.column) && <option value={rule.column}>{rule.column || 'Choose…'}</option>}
            {columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button variant="ghost" size="icon" aria-label={`Remove cleanup of ${rule.column}`} onClick={() => setConfirmDelete(true)}>
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input type="checkbox" className="size-5 accent-primary" checked={rule.normalize.ignoreCase} onChange={(e) => patch((r) => (r.normalize.ignoreCase = e.target.checked))} />
          Ignore capital letters
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Remove these characters</span>
          <Input value={rule.normalize.removeChars} onChange={(e) => patch((r) => (r.normalize.removeChars = e.target.value))} placeholder="e.g. ," aria-label="Characters to remove" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Show names in</span>
          <NativeSelect value={rule.displayCase} onChange={(e) => patch((r) => (r.displayCase = e.target.value as CleanupRule['displayCase']))}>
            <option value="title">Title Case</option>
            <option value="upper">UPPER CASE</option>
            <option value="asIs">As they are</option>
          </NativeSelect>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input type="checkbox" className="size-5 accent-primary" checked={rule.normalize.dotsToSpace ?? false} onChange={(e) => patch((r) => (r.normalize.dotsToSpace = e.target.checked))} />
          <span>
            Turn dots into spaces <span className="text-muted-foreground">(“K.KRISHNA” → “K KRISHNA”)</span>
          </span>
        </label>
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input type="checkbox" className="size-5 accent-primary" checked={rule.normalize.stripDrPrefix ?? false} onChange={(e) => patch((r) => (r.normalize.stripDrPrefix = e.target.checked))} />
          <span>
            Remove “Dr” at the start <span className="text-muted-foreground">(“Dr Rao” → “Rao”)</span>
          </span>
        </label>
        <div className="space-y-1 sm:col-span-2">
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-primary"
              checked={rule.normalize.stripSuffix?.enabled ?? false}
              onChange={(e) => patch((r) => (r.normalize.stripSuffix = { enabled: e.target.checked, text: r.normalize.stripSuffix?.text || ' (REVIEW)' }))}
            />
            Remove this text from the end of the name
          </label>
          {rule.normalize.stripSuffix?.enabled && (
            <Input
              className="max-w-xs"
              value={rule.normalize.stripSuffix.text}
              onChange={(e) => patch((r) => (r.normalize.stripSuffix = { enabled: true, text: e.target.value }))}
              placeholder="e.g. (REVIEW)"
              aria-label="Text to remove from the end"
            />
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Extra spaces at the start, end and between words are always removed. Capital letters do not matter for “Dr” and the ending.</p>

      {rule.aliases.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-sm font-semibold">Names you joined</h5>
          <ul className="divide-y rounded-lg border text-sm">
            {rule.aliases.map((a, i) => (
              <li key={`${a.to}-${i}`} className="flex items-center justify-between gap-2 p-2.5">
                <span className="min-w-0">
                  <span className="text-muted-foreground">{a.from.join(', ') || '(nothing)'}</span> → <b>{a.to}</b>
                </span>
                <Button size="sm" variant="ghost" onClick={() => patch((r) => void r.aliases.splice(i, 1))}>
                  Undo
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!report ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {running ? 'Reading your sample files…' : 'Add sample files in Sources to see the names this rule produces.'}
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            <b>{report.rawNames}</b> spellings became <b>{report.cleanNames}</b> names.
          </p>

          {(rule.normalize.dotsToSpace || rule.normalize.stripDrPrefix || rule.normalize.stripSuffix?.enabled) && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3" aria-label="Names changed by these options">
              <h5 className="text-sm font-semibold">
                {affected.length === 0 ? 'No name in your sample files is changed by these options.' : `${affected.length.toLocaleString('en-IN')} spelling${affected.length === 1 ? ' is' : 's are'} changed by these options`}
              </h5>
              {affected.length > 0 && (
                <>
                  <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
                    {(allAffected ? affected : affected.slice(0, 8)).map((v) => (
                      <li key={v.raw} className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="min-w-0 break-words">
                          “{v.raw}” → <b>{v.clean}</b>
                          <span className="ml-2 text-xs text-muted-foreground">{(v.steps ?? []).map((st) => STEP_LABEL[st]).join(', ')}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">{v.count.toLocaleString('en-IN')} rows</span>
                      </li>
                    ))}
                  </ul>
                  {!allAffected && affected.length > 8 && (
                    <Button variant="outline" size="sm" onClick={() => setAllAffected(true)}>
                      Show all {affected.length}
                    </Button>
                  )}
                </>
              )}
            </div>
          )}

          {report.suspicious.length > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-50 p-3 dark:bg-amber-950/30">
              <h5 className="text-sm font-semibold">These names may be the same. Please check.</h5>
              <ul className="space-y-2 text-sm">
                {report.suspicious.slice(0, 8).map((p, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      “{p.a}” and “{p.b}” <span className="text-xs text-muted-foreground">({p.reason})</span>
                    </span>
                    <Button size="sm" variant="outline" onClick={() => openMerge([p.a, p.b])}>
                      <Merge className="size-4" /> Join
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-40 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search names" className="pl-8" aria-label="Search names" />
            </div>
            <Button size="sm" disabled={selected.length < 2} onClick={() => openMerge(selected)}>
              <Merge className="size-4" /> Join {selected.length > 1 ? `${selected.length} names` : 'selected'}
            </Button>
          </div>

          <ul className="max-h-96 divide-y overflow-y-auto rounded-lg border" aria-label="Names after cleaning">
            {shown.map((n) => (
              <li key={n.name}>
                <label className="flex min-h-11 items-center gap-3 px-2.5 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-primary"
                    checked={selected.includes(n.name)}
                    onChange={(e) => setSelected((s) => (e.target.checked ? [...s, n.name] : s.filter((x) => x !== n.name)))}
                    aria-label={`Select ${n.name}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{n.name}</span>
                    {n.spellings.length > 1 && <span className="block truncate text-xs text-muted-foreground">also written: {n.spellings.filter((s) => s !== n.name).join(' · ')}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{n.count.toLocaleString('en-IN')} rows</span>
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className="p-3 text-sm text-muted-foreground">No names match.</li>}
          </ul>
          {!all && visible.length > shown.length && (
            <Button variant="outline" size="sm" onClick={() => setAll(true)}>
              Show all {visible.length} names
            </Button>
          )}
        </div>
      )}

      <Dialog open={mergeOpen} onOpenChange={(o) => !o && setMergeOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Join these names</DialogTitle>
            <DialogDescription>They will all appear as one name in the report. Choose the name to keep, or type another.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {selected.map((n) => (
              <label key={n} className="flex min-h-10 items-center gap-3 rounded-md border p-2 text-sm">
                <input type="radio" name="merge-target" className="size-4 accent-primary" checked={target === n} onChange={() => setTarget(n)} />
                <span className="flex-1">{n}</span>
                <span className="text-xs text-muted-foreground">{countOf(n)} rows</span>
              </label>
            ))}
            <Input value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Name to keep" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeOpen(false)}>
              Cancel
            </Button>
            <Button onClick={doMerge} disabled={target.trim() === ''}>
              Join
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        title={`Stop cleaning “${rule.column}”?`}
        description="The names in this column will be used exactly as they are in the files."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          update((r) => void r.cleanup.splice(index, 1));
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

export function CleanupSection({ reports, running }: { reports: readonly CleanupReport[] | undefined; running: boolean }) {
  const recipe = useBuilder((s) => s.recipe);
  const update = useBuilder((s) => s.update);
  if (!recipe) return null;
  const textColumns = combinedColumns(recipe).filter((c) => c.type === 'text' && !c.name.startsWith('_') && c.name !== 'Source');
  const unused = textColumns.filter((c) => !recipe.cleanup.some((r) => r.column.toUpperCase() === c.name.toUpperCase()));

  return (
    <section className="space-y-3" aria-labelledby="cleanup-h">
      <div>
        <h2 id="cleanup-h" className="text-lg font-medium">
          Clean up names
        </h2>
        <p className="text-sm text-muted-foreground">
          The same doctor or department is often written in different ways (“Dr. A Kumar”, “dr a kumar”). A cleanup rule makes them one name so they add up together.
        </p>
      </div>
      {recipe.cleanup.map((r, i) => (
        <RuleCard key={`${r.column}-${i}`} index={i} report={reports?.find((x) => x.column.toUpperCase() === r.column.toUpperCase())} running={running} />
      ))}
      {unused.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Clean up:</span>
          {unused.slice(0, 8).map((c) => (
            <Button key={c.name} variant="outline" size="sm" onClick={() => update((r) => void r.cleanup.push(NEW_RULE(c.name)))}>
              <Plus className="size-4" /> {c.name}
            </Button>
          ))}
        </div>
      ) : (
        recipe.cleanup.length === 0 && <p className="text-sm text-muted-foreground">Pick columns in Sources first. Text columns can be cleaned here.</p>
      )}
    </section>
  );
}
