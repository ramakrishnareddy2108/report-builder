type Props = { fraction: number; label?: string; detail?: string };

/** A progress bar for the worker: a plain-language step and how far along it is. */
export function ProgressBar({ fraction, label, detail }: Props) {
  const pct = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
  return (
    <div role="status" aria-live="polite" className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label ?? 'Working…'}</span>
        <span className="text-muted-foreground">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}
