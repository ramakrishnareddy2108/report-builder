import { Check, GitMerge, Split } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useNameScan } from '@/app/nameScan';
import { useSettings } from '@/app/settingsStore';
import { useSaveDoctors } from '@/app/useSaveDoctors';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { plural } from '@/lib/plural';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  DoctorMatcher,
  GroupResolver,
  acceptSuggestions,
  addAliases,
  mergeSuggestions,
  splitSuggestion,
  suggestDoctors,
  type DoctorSuggestion,
} from '@/core/doctors';
import { AliasList } from './AliasList';
import { DepartmentSelect } from './DepartmentSelect';

/** Raw doctor spellings that no doctor in the master matches yet, grouped by normalised name. */
export function DoctorSuggestions({ departmentOptions }: { departmentOptions: string[] }) {
  const result = useNameScan((s) => s.result);
  const doctorsFile = useSettings((s) => s.doctors);
  const save = useSaveDoctors();

  const suggested = useMemo(
    () => (result ? suggestDoctors(result.doctors, doctorsFile.doctors, new GroupResolver(doctorsFile.departments)) : []),
    [result, doctorsFile.doctors, doctorsFile.departments],
  );
  const [items, setItems] = useState<DoctorSuggestion[]>(suggested);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    setItems(suggested);
    setSelected(new Set());
  }, [suggested]);

  if (!result) return null;
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        Every doctor name in the scanned files is already in the doctor list.
      </p>
    );
  }

  const edit = (key: string, patch: Partial<DoctorSuggestion>) =>
    setItems((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const toggle = (key: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const chosen = items.filter((s) => selected.has(s.key));

  async function accept(list: DoctorSuggestion[]) {
    if (list.length === 0) return;
    const blank = list.find((s) => s.displayName.trim() === '');
    if (blank) return void toast.error('Every doctor needs a name.');
    await save(
      { ...doctorsFile, doctors: acceptSuggestions(doctorsFile.doctors, list) },
      `Added ${list.length} doctor${list.length === 1 ? '' : 's'}.`,
    );
  }

  function mergeChosen() {
    const merged = mergeSuggestions(chosen);
    setItems((list) => {
      const at = list.findIndex((s) => s.key === chosen[0]?.key);
      const rest = list.filter((s) => !selected.has(s.key));
      return [...rest.slice(0, at), merged, ...rest.slice(at)];
    });
    setSelected(new Set());
  }

  async function mergeIntoBase(item: DoctorSuggestion) {
    const base = items.find((s) => s.key === item.mergeSuggestion);
    if (base) {
      setItems((list) => list.filter((s) => s.key !== item.key).map((s) => (s.key === base.key ? mergeSuggestions([base, item]) : s)));
      return;
    }
    // The plain-name doctor is already in the master: add these spellings to them.
    const match = item.mergeSuggestion ? new DoctorMatcher(doctorsFile.doctors).match(item.mergeSuggestion) : null;
    if (match?.status === 'matched') {
      await save(
        { ...doctorsFile, doctors: addAliases(doctorsFile.doctors, match.doctor.id, item.aliases.map((a) => a.raw)) },
        `Added to ${match.doctor.displayName}.`,
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New doctor names ({items.length})</CardTitle>
        <CardDescription>
          Spellings that differ only in case, spaces, dots or a leading “Dr” are grouped. Check each group, then add
          it. Names with “(REVIEW)” are kept apart so you can decide; they are usually the same doctor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
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

        <ul className="divide-y rounded-lg border" aria-label="New doctor names">
          {items.map((s) => (
            <li key={s.key} className="grid gap-2 px-4 py-3 md:grid-cols-[auto_1fr_14rem_auto] md:items-start">
              <input
                type="checkbox"
                className="mt-2 size-4"
                checked={selected.has(s.key)}
                onChange={() => toggle(s.key)}
                aria-label={`Select ${s.displayName}`}
              />
              <div className="space-y-1.5">
                <Input
                  value={s.displayName}
                  onChange={(e) => edit(s.key, { displayName: e.target.value })}
                  aria-label={`Display name for ${s.key}`}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <AliasList aliases={s.aliases.map((a) => a.raw)} />
                  <span className="text-xs text-muted-foreground">{plural(s.count, 'row')}</span>
                  {s.suffix && <Badge variant="outline">({s.suffix})</Badge>}
                </div>
              </div>
              <DepartmentSelect
                value={s.department}
                options={departmentOptions}
                onChange={(department) => edit(s.key, { department })}
                label={`Department for ${s.displayName}`}
              />
              <div className="flex gap-1">
                {s.mergeSuggestion && (
                  <Button variant="outline" size="sm" onClick={() => void mergeIntoBase(s)}>
                    <GitMerge />
                    Same as {s.mergeSuggestion}
                  </Button>
                )}
                {s.aliases.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => setItems((list) => list.flatMap((x) => (x.key === s.key ? splitSuggestion(x) : [x])))}>
                    <Split />
                    Split
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
