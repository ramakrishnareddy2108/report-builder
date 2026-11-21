import { Input } from '@/components/ui/input';

type Props = { value: string; onChange: (month: string) => void; label?: string };

/** Pick a month ('YYYY-MM'). Chrome and Edge show a month selector. */
export function MonthPicker({ value, onChange, label = 'Month' }: Props) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-medium">{label}</span>
      <Input
        type="month"
        value={value}
        onChange={(e) => /^\d{4}-\d{2}$/.test(e.target.value) && onChange(e.target.value)}
        className="w-44"
        aria-label={label}
      />
    </label>
  );
}
