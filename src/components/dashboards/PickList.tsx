import { useState } from 'react';
import { Input } from '@/components/ui/input';

type Props = {
  label: string;
  options: readonly { value: string; label: string }[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  /** Shown when nothing is picked, for example "All departments". */
  empty: string;
};

/** A searchable list of checkboxes inside a collapsible box (for filters and measures). */
export function PickList({ label, options, selected, onChange, empty }: Props) {
  const [query, setQuery] = useState('');
  const shown = options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter((s) => s !== value) : [...selected, value]);
  const summary = selected.length === 0 ? empty : selected.length <= 2 ? options.filter((o) => selected.includes(o.value)).map((o) => o.label).join(', ') : `${selected.length} chosen`;

  return (
    <details className="group rounded-lg border bg-background">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-sm [&::-webkit-details-marker]:hidden">
        <span className="font-medium">{label}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{summary}</span>
        <span className="text-xs text-muted-foreground group-open:hidden">Change</span>
      </summary>
      <div className="space-y-2 border-t p-2">
        {options.length > 8 && <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label}`} />}
        <ul className="max-h-48 space-y-0.5 overflow-auto" aria-label={label}>
          {shown.map((o) => (
            <li key={o.value}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
                <input type="checkbox" className="size-4" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                {o.label}
              </label>
            </li>
          ))}
          {shown.length === 0 && <li className="px-1.5 py-1 text-sm text-muted-foreground">Nothing matches.</li>}
        </ul>
        {selected.length > 0 && (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </div>
    </details>
  );
}
