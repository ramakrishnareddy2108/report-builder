import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { formatINR } from '@/core/money';
import type { Check } from '@/engine/checks';
import { cn } from '@/lib/utils';

const STYLE = {
  error: { icon: CircleAlert, box: 'border-destructive/40 bg-destructive/5', text: 'text-destructive', label: 'To fix' },
  warning: { icon: TriangleAlert, box: 'border-amber-500/40 bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-800 dark:text-amber-300', label: 'Please check' },
  info: { icon: Info, box: 'border-border bg-background', text: 'text-muted-foreground', label: 'Information' },
} as const;

function CheckItem({ check, onFix }: { check: Check; onFix?: (check: Check) => void }) {
  const s = STYLE[check.level];
  const Icon = s.icon;
  const details = check.details ?? [];
  const limit = check.detailLimit ?? 25;
  return (
    <li className={cn('space-y-2 rounded-lg border p-3 text-sm', s.box)} role={check.level === 'error' ? 'alert' : undefined}>
      <div className="flex gap-2">
        <Icon className={cn('mt-0.5 size-4 shrink-0', s.text)} aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">{check.title}</p>
          <p>{check.message}</p>
          {(check.rows !== undefined || check.amountPaise !== undefined) && (
            <p className="text-xs text-muted-foreground">
              {check.rows !== undefined && `${check.rows.toLocaleString('en-IN')} rows`}
              {check.rows !== undefined && check.amountPaise !== undefined && ' · '}
              {check.amountPaise !== undefined && formatINR(check.amountPaise)}
            </p>
          )}
        </div>
        {onFix && check.level === 'error' && check.sourceId && (
          <button type="button" onClick={() => onFix(check)} className="min-h-9 shrink-0 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted">
            Fix mapping
          </button>
        )}
      </div>
      {details.length > 0 && (
        <details className="pl-6">
          <summary className="cursor-pointer text-xs font-medium">Show {details.length > limit ? `first ${limit} of ` : ''}{details.length} example{details.length === 1 ? '' : 's'}</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {details.slice(0, limit).map((d, i) => (
              <li key={i} className="break-words">
                {d.file && <span className="text-muted-foreground">{d.file} </span>}
                {d.row !== undefined && <b>row {d.row}: </b>}
                {d.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/** The checks of a run: errors first (they block the download), then warnings, then information. */
export function ChecksPanel({ checks, onFix }: { checks: readonly Check[]; onFix?: (check: Check) => void }) {
  const by = (level: Check['level']) => checks.filter((c) => c.level === level);
  const errors = by('error');
  const warnings = by('warning');
  const info = by('info');

  return (
    <div className="space-y-4" aria-label="Checks">
      {errors.length === 0 && (
        <p className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          <CircleCheck className="size-4 shrink-0" aria-hidden />
          {warnings.length === 0 ? 'All checks passed.' : `No errors. ${warnings.length} thing${warnings.length === 1 ? '' : 's'} to look at.`}
        </p>
      )}
      {errors.length > 0 && (
        <section className="space-y-2" aria-label="Errors">
          <h3 className="text-sm font-semibold text-destructive">{errors.length} problem{errors.length === 1 ? '' : 's'} to fix before you can download</h3>
          <ul className="space-y-2">
            {errors.map((c, i) => (
              <CheckItem key={i} check={c} onFix={onFix} />
            ))}
          </ul>
        </section>
      )}
      {warnings.length > 0 && (
        <section className="space-y-2" aria-label="Warnings">
          <h3 className="text-sm font-semibold">{warnings.length} to check</h3>
          <ul className="space-y-2">
            {warnings.map((c, i) => (
              <CheckItem key={i} check={c} />
            ))}
          </ul>
        </section>
      )}
      {info.length > 0 && (
        <details className="space-y-2">
          <summary className="cursor-pointer text-sm font-semibold">Details of what was read ({info.length})</summary>
          <ul className="mt-2 space-y-2">
            {info.map((c, i) => (
              <CheckItem key={i} check={c} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
