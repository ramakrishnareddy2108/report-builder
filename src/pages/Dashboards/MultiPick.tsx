import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

type Props = {
  label: string;
  options: readonly string[];
  selected: readonly string[];
  onChange: (values: string[]) => void;
};

/** A filter: shows "All" or how many are chosen; opens a list with a search box and tick boxes (easy on a phone). */
export function MultiPick({ label, options, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const shown = options.filter((o) => o.toLowerCase().includes(query.toLowerCase()));
  const summary = selected.length === 0 ? 'All' : selected.length === 1 ? (selected[0] as string) : `${selected.length} chosen`;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} aria-haspopup="dialog" className="max-w-full justify-between gap-2">
        <span className="truncate">
          {label}: <b>{summary}</b>
        </span>
        <ChevronDown className="size-4 shrink-0" aria-hidden />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>Tick the ones to show. Leave everything unticked to show all.</DialogDescription>
          </DialogHeader>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label={`Search ${label}`} />
          <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
            {shown.map((o) => (
              <li key={o}>
                <label className="flex min-h-11 items-center gap-3 px-3 text-sm">
                  <input type="checkbox" className="size-5 accent-primary" checked={selected.includes(o)} onChange={(e) => onChange(e.target.checked ? [...selected, o] : selected.filter((x) => x !== o))} />
                  <span className="min-w-0 flex-1 truncate">{o}</span>
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className="p-3 text-sm text-muted-foreground">Nothing matches.</li>}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => onChange([])} disabled={selected.length === 0}>
              Show all
            </Button>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
