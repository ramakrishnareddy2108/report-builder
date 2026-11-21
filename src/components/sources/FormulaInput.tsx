import { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { validateFormula } from '@/formula';

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Unique column names of the sheet, offered as clickable chips. */
  columns: readonly string[];
  /** Columns the file does not have (from resolving the mapping). */
  missingColumns?: readonly string[];
  label: string;
  placeholder?: string;
};

/** A formula box with live validation and clickable column chips that insert [Column]. */
export function FormulaInput({ value, onChange, columns, missingColumns = [], label, placeholder }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const check = value.trim() === '' ? null : validateFormula(value);
  const unknown = check?.ok ? check.columns.filter((c) => missingColumns.includes(c)) : [];

  const insert = (name: string) => {
    const el = input.current;
    const at = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? at;
    onChange(`${value.slice(0, at)}[${name}]${value.slice(end)}`);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + name.length + 2, at + name.length + 2);
    });
  };

  return (
    <div className="space-y-1.5">
      <Input
        ref={input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'For example [GROSSAMOUNT] - [CONCESSION]'}
        aria-label={label}
        aria-invalid={check?.ok === false || unknown.length > 0}
        className="font-mono"
        spellCheck={false}
      />
      {check && !check.ok && (
        <p className="text-xs text-destructive" role="alert">
          {check.message} (at character {check.position + 1})
        </p>
      )}
      {unknown.length > 0 && (
        <p className="text-xs text-destructive" role="alert">
          {unknown.map((c) => `[${c}]`).join(', ')} {unknown.length === 1 ? 'is' : 'are'} not in this file.
        </p>
      )}
      {check?.ok && unknown.length === 0 && <p className="text-xs text-emerald-700">Formula is valid.</p>}
      {columns.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Insert a column</summary>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {columns.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => insert(c)}
                className="rounded-md border bg-background px-1.5 py-0.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                {c}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
