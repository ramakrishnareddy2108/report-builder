import { useId, useMemo, useRef } from 'react';
import { validateFormula } from '@/formula';
import { cn } from '@/lib/utils';

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Columns the formula may use: shown as chips that insert [Name] where the cursor is. */
  columns: readonly string[];
  /** True when a column used by the formula exists. Unknown columns are reported. */
  columnExists?: (name: string) => boolean;
  placeholder?: string;
  hint?: string;
  rows?: number;
  /** An empty formula is fine (for example an optional row filter). */
  optional?: boolean;
};

/** A formula box that checks as you type and lists the columns you can click to insert. */
export function FormulaField({ label, value, onChange, columns, columnExists, placeholder, hint, rows = 2, optional }: Props) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);

  const problem = useMemo(() => {
    if (value.trim() === '') return optional ? null : 'Type a formula.';
    const result = validateFormula(value);
    if (!result.ok) return `${result.message} (at character ${result.position + 1})`;
    const unknown = columnExists ? result.columns.filter((c) => !columnExists(c)) : [];
    return unknown.length > 0 ? `Column ${unknown.map((c) => `[${c}]`).join(', ')} was not found.` : null;
  }, [value, columnExists, optional]);

  function insert(name: string) {
    const el = area.current;
    const token = `[${name}]`;
    if (!el) return onChange(value + token);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        ref={area}
        rows={rows}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        aria-invalid={problem !== null}
        aria-describedby={`${id}-msg`}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full rounded-lg border bg-transparent px-2.5 py-2 font-mono text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm',
          problem ? 'border-destructive' : 'border-input',
        )}
      />
      <p id={`${id}-msg`} className={cn('text-xs', problem ? 'text-destructive' : 'text-muted-foreground')} role={problem ? 'alert' : undefined}>
        {problem ?? (value.trim() !== '' ? '✓ The formula is valid.' : (hint ?? ''))}
      </p>
      {columns.length > 0 && (
        <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto" aria-label="Columns you can insert">
          {columns.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => insert(c)}
              className="min-h-8 rounded-full border bg-muted/40 px-2.5 text-xs hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
