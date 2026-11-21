import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const NONE = '__none__';

type Props = {
  value: string | null;
  options: readonly string[];
  onChange: (value: string | null) => void;
  label: string;
};

/** Pick a department from the known names (the current value is always offered). */
export function DepartmentSelect({ value, options, onChange, label }: Props) {
  const all = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger aria-label={label} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No department</SelectItem>
        {all.map((d) => (
          <SelectItem key={d} value={d}>
            {d}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
