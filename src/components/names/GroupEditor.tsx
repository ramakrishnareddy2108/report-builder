import { Check, GitMerge, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useNameScan } from '@/app/nameScan';
import { useSettings } from '@/app/settingsStore';
import { useSaveDoctors } from '@/app/useSaveDoctors';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { plural } from '@/lib/plural';
import { Input } from '@/components/ui/input';
import {
  acceptGroupSuggestions,
  mergeGroupSuggestions,
  removeGroupAlias,
  renameGroup,
  suggestGroups,
  type GroupSuggestion,
} from '@/core/doctors';
import type { NameGroup } from '@/core/types';
import { AliasList } from './AliasList';

type Props = {
  /** Which list of doctors.json this edits. */
  list: 'departments' | 'sponsors';
  /** Singular and plural, for messages. */
  noun: string;
  nouns: string;
  explanation: string;
};

/** Optional grouping of department or sponsor spellings (a name with no group is used as written, upper-cased). */
export function GroupEditor({ list, noun, nouns, explanation }: Props) {
  const file = useSettings((s) => s.doctors);
  const result = useNameScan((s) => s.result);
  const save = useSaveDoctors();
  const groups = file[list];

  const suggested = useMemo(
    () => suggestGroups(result ? result[list] : [], groups),
    [result, list, groups],
  );
  const [items, setItems] = useState<GroupSuggestion[]>(suggested);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState<NameGroup | null>(null);
  useEffect(() => {
    setItems(suggested);
    setSelected(new Set());
  }, [suggested]);

  const apply = (next: NameGroup[], message?: string) => save({ ...file, [list]: next }, message);
  const chosen = items.filter((s) => selected.has(s.key));

  async function accept(chosenItems: GroupSuggestion[]) {
    if (chosenItems.some((s) => s.name.trim() === '')) return void toast.error(`Every ${noun} needs a name.`);
    await apply(acceptGroupSuggestions(groups, chosenItems), `Added ${chosenItems.length} ${chosenItems.length === 1 ? noun : nouns}.`);
  }

  function mergeChosen() {
    const merged = mergeGroupSuggestions(chosen);
    setItems((cur) => {
      const at = cur.findIndex((s) => s.key === chosen[0]?.key);
      const rest = cur.filter((s) => !selected.has(s.key));
      return [...rest.slice(0, at), merged, ...rest.slice(at)];
    });
    setSelected(new Set());
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{explanation}</p>

      {items.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-medium">
            Found in the scanned files ({items.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void accept(items)}>
              <Check />
              Add all ({items.length})
            </Button>
            <Button variant="outline" disabled={chosen.length === 0} onClick={() => void accept(chosen)}>
              Add selected ({chosen.length})
            </Button>
            <Button variant="outline" disabled={chosen.length < 2} onClick={mergeChosen}>
              <GitMerge />
              Merge selected
            </Button>
          </div>
          <ul className="divide-y rounded-lg border" aria-label={`New ${nouns}`}>
            {items.map((s) => (
              <li key={s.key} className="grid gap-2 px-4 py-3 md:grid-cols-[auto_1fr_auto] md:items-start">
                <input
                  type="checkbox"
                  className="mt-2 size-4"
                  checked={selected.has(s.key)}
                  onChange={() =>
                    setSelected((cur) => {
                      const next = new Set(cur);
                      if (!next.delete(s.key)) next.add(s.key);
                      return next;
                    })
                  }
                  aria-label={`Select ${s.name}`}
                />
                <div className="space-y-1.5">
                  <Input
                    value={s.name}
                    onChange={(e) => setItems((cur) => cur.map((x) => (x.key === s.key ? { ...x, name: e.target.value } : x)))}
                    aria-label={`Name for ${s.key}`}
                  />
                  <AliasList aliases={s.aliases.map((a) => a.raw)} />
                </div>
                <span className="text-xs text-muted-foreground md:pt-2">{plural(s.count, 'row')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {groups.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-medium">Saved groups ({groups.length})</h3>
          <ul className="divide-y rounded-lg border" aria-label={`Saved ${nouns}`}>
            {groups.map((g) => (
              <li key={g.name} className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_auto] md:items-start">
                <div className="space-y-1.5">
                  <Input
                    key={g.name}
                    defaultValue={g.name}
                    aria-label={`Name of ${g.name}`}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name === g.name) return;
                      if (name === '') return void toast.error(`A ${noun} needs a name.`);
                      void apply(renameGroup(groups, g.name, name));
                    }}
                  />
                  <AliasList
                    aliases={g.aliases}
                    onRemove={(alias) => void apply(removeGroupAlias(groups, g.name, alias), 'Spelling unlinked.')}
                  />
                </div>
                <Button variant="ghost" size="icon" aria-label={`Delete ${g.name}`} onClick={() => setDeleting(g)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {items.length === 0 && groups.length === 0 && (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {result ? `No ${nouns} to group.` : `Scan this month’s files to see the ${noun} names they use.`} Without a group,
          each name is used as written (upper-case).
        </p>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete the group “${deleting?.name ?? ''}”?`}
        description={`Its spellings are used as written again. Saved runs are not changed.`}
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void apply(groups.filter((g) => g.name !== deleting.name), 'Group deleted.');
          setDeleting(null);
        }}
      />
    </div>
  );
}
