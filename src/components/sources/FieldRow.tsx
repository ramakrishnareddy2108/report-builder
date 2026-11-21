import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FIELD_KINDS, FIELD_LABELS, type FieldKey, type FieldMapping } from '@/core/types';
import { columnLabel, columnMappingAt, isPatientColumn, type MappingProblem, type ResolvedField, type SheetHeader } from '@/excel/mapSource';
import { FormulaInput } from './FormulaInput';

type Mode = FieldMapping['type'];

const MODE_LABELS: Record<Mode, string> = {
  column: 'Column',
  fixed: 'Fixed value',
  formula: 'Formula',
  none: 'Not used',
};

type Props = {
  field: FieldKey;
  mapping: FieldMapping | undefined;
  resolved: ResolvedField | undefined;
  header: SheetHeader;
  problems: readonly MappingProblem[];
  /** The measure rules need this field from the source. */
  required: boolean;
  onChange: (next: FieldMapping) => void;
};

function emptyFor(mode: Mode): FieldMapping {
  switch (mode) {
    case 'column':
      return { type: 'column', value: '' };
    case 'fixed':
      return { type: 'fixed', value: '' };
    case 'formula':
      return { type: 'formula', value: '' };
    case 'none':
      return { type: 'none', value: null };
  }
}

/** One field of a source: where its value comes from. */
export function FieldRow({ field, mapping, resolved, header, problems, required, onChange }: Props) {
  const mode: Mode = mapping?.type ?? 'none';
  const { label, hint } = FIELD_LABELS[field];
  const money = FIELD_KINDS[field] === 'money';
  const selectedColumn = resolved?.type === 'column' ? String(resolved.index) : undefined;
  const missing = problems.filter((p) => p.field === field).flatMap((p) => p.missingColumns);

  return (
    <div className="grid grid-cols-1 gap-2 px-4 py-3 md:grid-cols-[14rem_9rem_1fr] md:items-start">
      <div>
        <div className="text-sm font-medium">
          {label}
          {required && <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-normal text-muted-foreground">needed</span>}
        </div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>

      <Select value={mode} onValueChange={(m) => onChange(emptyFor(m as Mode))}>
        <SelectTrigger aria-label={`How to read ${label}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <SelectItem key={m} value={m}>
              {MODE_LABELS[m]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="min-w-0 space-y-1.5">
        {mapping?.type === 'column' && (
          <>
            <Select
              value={selectedColumn ?? ""}
              onValueChange={(i) => onChange(columnMappingAt(header.rawHeaders, Number(i)))}
            >
              <SelectTrigger aria-label={`Column for ${label}`} aria-invalid={resolved === undefined}>
                <SelectValue placeholder="Choose a column" />
              </SelectTrigger>
              <SelectContent>
                {header.rawHeaders.map((h, i) => (
                  <SelectItem key={i} value={String(i)} disabled={isPatientColumn(h)}>
                    {columnLabel(header.rawHeaders, i)}
                    {isPatientColumn(h) && ' (patient details, not allowed)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {resolved === undefined && mapping.value !== '' && (
              <p className="text-xs text-destructive" role="alert">
                {missing.length > 0 ? `“${missing[0]}”` : 'This column'} is not in the file. Choose another column.
              </p>
            )}
          </>
        )}
        {mapping?.type === 'fixed' && (
          <Input
            value={String(mapping.value)}
            onChange={(e) => {
              const v = e.target.value;
              onChange({ type: 'fixed', value: money && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : v });
            }}
            placeholder={money ? 'Amount in rupees' : 'Same value on every row'}
            aria-label={`Fixed value for ${label}`}
          />
        )}
        {mapping?.type === 'formula' && (
          <FormulaInput
            label={`Formula for ${label}`}
            value={mapping.value}
            onChange={(value) => onChange({ type: 'formula', value })}
            columns={header.headers}
            missingColumns={problems.filter((p) => p.field === field).flatMap((p) => p.missingColumns)}
          />
        )}
        {mode === 'none' && <p className="pt-1.5 text-xs text-muted-foreground">This source does not provide it.</p>}
        {required && mode === 'none' && (
          <p className="text-xs text-destructive" role="alert">
            The measure rules need this field.
          </p>
        )}
      </div>
    </div>
  );
}
