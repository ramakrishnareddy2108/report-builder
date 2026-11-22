import { ChevronDown, CircleCheck, CircleAlert, Lightbulb, SquareFunction } from 'lucide-react';
import { useId, useMemo, useRef } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { validateFormula } from '@/formula';
import { cn } from '@/lib/utils';

export type FormulaExample = { label: string; formula: string };

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Columns the formula may use: shown as chips that insert [Name] where the cursor is. */
  columns: readonly string[];
  /** Heading over the chips, saying WHICH columns these are (the scope differs by place). */
  columnsLabel?: string;
  /** True when a column used by the formula exists. Unknown columns are reported. */
  columnExists?: (name: string) => boolean;
  placeholder?: string;
  hint?: string;
  rows?: number;
  /** An empty formula is fine (for example an optional row filter). */
  optional?: boolean;
  /** Ready-made formulas offered in an "Examples" menu. Choosing one replaces the formula. */
  examples?: readonly FormulaExample[];
};

/** Buttons that type an operator. `insert` is what goes into the formula. */
const OPERATORS: readonly { show: string; insert: string; title: string }[] = [
  { show: '+', insert: ' + ', title: 'Add' },
  { show: '−', insert: ' - ', title: 'Subtract' },
  { show: '×', insert: ' * ', title: 'Multiply' },
  { show: '÷', insert: ' / ', title: 'Divide' },
  { show: '( )', insert: '()', title: 'Brackets' },
  { show: '=', insert: ' = ', title: 'Is equal to' },
  { show: '≠', insert: ' <> ', title: 'Is not equal to' },
  { show: '>', insert: ' > ', title: 'Greater than' },
  { show: '<', insert: ' < ', title: 'Less than' },
  { show: '"abc"', insert: '""', title: 'Text in quotes' },
];

/** The functions most finance users need, in plain words. The full list is on the Help page. */
const FUNCTION_GROUPS: readonly { group: string; items: readonly { name: string; args: string; text: string }[] }[] = [
  {
    group: 'Decide',
    items: [
      { name: 'IF', args: 'test, value if yes, value if no', text: 'Pick one of two values' },
      { name: 'IFERROR', args: 'value, use instead', text: 'Fallback when it fails, e.g. divide by 0' },
      { name: 'AND', args: 'test 1, test 2', text: 'TRUE when all tests are true' },
      { name: 'OR', args: 'test 1, test 2', text: 'TRUE when any test is true' },
      { name: 'NOT', args: 'test', text: 'Turns TRUE into FALSE' },
      { name: 'ISBLANK', args: 'value', text: 'Is the cell empty?' },
    ],
  },
  {
    group: 'Numbers',
    items: [
      { name: 'ROUND', args: 'number, decimals', text: 'Round, e.g. to 2 decimals' },
      { name: 'ABS', args: 'number', text: 'Drop the minus sign' },
      { name: 'MIN', args: 'a, b', text: 'The smaller value' },
      { name: 'MAX', args: 'a, b', text: 'The larger value' },
      { name: 'SUM', args: 'a, b, c', text: 'Add values together' },
    ],
  },
  {
    group: 'Text',
    items: [
      { name: 'CONTAINS', args: 'text, look for', text: 'Does the text contain…? (any case)' },
      { name: 'STARTSWITH', args: 'text, start', text: 'Does the text start with…?' },
      { name: 'PROPER', args: 'text', text: 'Title Case The Text' },
      { name: 'UPPER', args: 'text', text: 'CAPITAL LETTERS' },
      { name: 'TRIM', args: 'text', text: 'Remove extra spaces' },
      { name: 'CONCAT', args: 'a, b', text: 'Join texts together' },
    ],
  },
  {
    group: 'Dates',
    items: [
      { name: 'TEXT', args: 'date, "MMM-YYYY"', text: 'Date as text, e.g. Oct-2026' },
      { name: 'MONTH', args: 'date', text: 'Month number 1–12' },
      { name: 'YEAR', args: 'date', text: 'The year' },
    ],
  },
];

const toolButton =
  'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-2 text-sm font-medium text-foreground/80 hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none';

/** A formula box that checks as you type, with buttons to click a formula together instead of typing it. */
export function FormulaField({ label, value, onChange, columns, columnsLabel = 'Columns you can use here', columnExists, placeholder, hint, rows = 2, optional, examples }: Props) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  /** The cursor when the box last had focus, so a menu click still inserts in the right place. */
  const caret = useRef<{ start: number; end: number } | null>(null);

  const problem = useMemo(() => {
    if (value.trim() === '') return optional ? null : 'Type a formula, or build one with the buttons below.';
    const result = validateFormula(value);
    if (!result.ok) return `${result.message} (at character ${result.position + 1})`;
    const unknown = columnExists ? result.columns.filter((c) => !columnExists(c)) : [];
    return unknown.length > 0 ? `Column ${unknown.map((c) => `[${c}]`).join(', ')} was not found. Pick one from the list below.` : null;
  }, [value, columnExists, optional]);

  const remember = () => {
    const el = area.current;
    if (el) caret.current = { start: el.selectionStart ?? value.length, end: el.selectionEnd ?? value.length };
  };

  /** Puts `text` at the cursor; the cursor ends `back` characters before its end (inside brackets or quotes). */
  function insert(text: string, back = 0) {
    const el = area.current;
    const at = caret.current ?? { start: value.length, end: value.length };
    const next = value.slice(0, at.start) + text + value.slice(at.end);
    onChange(next);
    const pos = at.start + text.length - back;
    caret.current = { start: pos, end: pos };
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  const valid = problem === null && value.trim() !== '';

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div
        className={cn(
          'overflow-hidden rounded-xl border bg-card transition-shadow focus-within:ring-3 focus-within:ring-ring/40',
          problem ? 'border-destructive' : valid ? 'border-primary/40' : 'border-input',
        )}
      >
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
          onSelect={remember}
          onKeyUp={remember}
          onClick={remember}
          onBlur={remember}
          className="block w-full resize-y bg-transparent px-3 py-2.5 font-mono text-base outline-none md:text-sm"
        />
        <div className="flex flex-wrap items-center gap-0.5 border-t bg-muted/50 px-1.5 py-1" role="toolbar" aria-label="Formula helpers">
          {OPERATORS.map((op) => (
            <button key={op.show} type="button" title={op.title} aria-label={op.title} className={cn(toolButton, 'font-mono')} onClick={() => insert(op.insert, op.insert === '()' || op.insert === '""' ? 1 : 0)}>
              {op.show}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <DropdownMenu>
            <DropdownMenuTrigger className={toolButton}>
              <SquareFunction className="size-4 text-primary" aria-hidden /> Function <ChevronDown className="size-3.5 opacity-60" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 w-80 overflow-y-auto">
              {FUNCTION_GROUPS.map((g, gi) => (
                <div key={g.group}>
                  {gi > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="text-xs text-muted-foreground">{g.group}</DropdownMenuLabel>
                  {g.items.map((f) => (
                    <DropdownMenuItem key={f.name} onSelect={() => insert(`${f.name}()`, 1)} className="flex-col items-start gap-0">
                      <span className="font-mono text-xs">
                        <b>{f.name}</b>
                        <span className="text-muted-foreground">({f.args})</span>
                      </span>
                      <span className="text-xs text-muted-foreground">{f.text}</span>
                    </DropdownMenuItem>
                  ))}
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {examples && examples.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger className={toolButton}>
                <Lightbulb className="size-4 text-amber-500" aria-hidden /> Examples <ChevronDown className="size-3.5 opacity-60" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-80">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Choosing one replaces the formula</DropdownMenuLabel>
                {examples.map((ex) => (
                  <DropdownMenuItem key={ex.label} onSelect={() => onChange(ex.formula)} className="flex-col items-start gap-0.5">
                    <span className="text-sm">{ex.label}</span>
                    <span className="font-mono text-xs break-all text-muted-foreground">{ex.formula}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <p id={`${id}-msg`} className={cn('flex items-start gap-1.5 text-xs', problem ? 'text-destructive' : valid ? 'text-primary' : 'text-muted-foreground')} role={problem ? 'alert' : undefined}>
        {problem ? <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden /> : valid ? <CircleCheck className="mt-px size-3.5 shrink-0" aria-hidden /> : null}
        {problem ?? (valid ? 'The formula is valid.' : (hint ?? ''))}
      </p>
      {columns.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{columnsLabel} (click to insert)</p>
          <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto" aria-label={columnsLabel}>
            {columns.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => insert(`[${c}]`)}
                className="min-h-8 rounded-full border border-primary/20 bg-accent/60 px-2.5 text-xs text-accent-foreground hover:border-primary/50 hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
