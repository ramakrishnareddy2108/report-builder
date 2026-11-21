import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import type { Issue } from '@/engine/types';
import { cn } from '@/lib/utils';

const STYLE = {
  error: { icon: CircleAlert, box: 'border-destructive/40 bg-destructive/5', text: 'text-destructive' },
  warning: { icon: TriangleAlert, box: 'border-amber-500/40 bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-800 dark:text-amber-300' },
  info: { icon: Info, box: 'border-border bg-muted/30', text: 'text-muted-foreground' },
} as const;

/** A plain list of problems and notes, worst first. */
export function IssueList({ issues }: { issues: readonly Issue[] }) {
  if (issues.length === 0) return null;
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...issues].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <ul className="space-y-2">
      {sorted.map((issue, i) => {
        const s = STYLE[issue.level];
        const Icon = s.icon;
        return (
          <li key={i} role={issue.level === 'error' ? 'alert' : undefined} className={cn('flex gap-2 rounded-lg border p-3 text-sm', s.box)}>
            <Icon className={cn('mt-0.5 size-4 shrink-0', s.text)} aria-hidden />
            <span>{issue.message}</span>
          </li>
        );
      })}
    </ul>
  );
}
