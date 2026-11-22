import { cn } from '@/lib/utils';

/** The app's mark: three rising bars in a rounded tile (a report that adds up). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl bg-hero shadow-sm ring-1 ring-white/15', className)}>
      <svg viewBox="0 0 24 24" className="size-5" fill="none">
        <rect x="4" y="13" width="4" height="7" rx="1.2" fill="white" fillOpacity="0.65" />
        <rect x="10" y="9" width="4" height="11" rx="1.2" fill="white" fillOpacity="0.85" />
        <rect x="16" y="4" width="4" height="16" rx="1.2" fill="oklch(0.88 0.13 85)" />
      </svg>
    </span>
  );
}
