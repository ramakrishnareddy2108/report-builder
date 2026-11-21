import { CheckCircle2, ChevronRight, TriangleAlert, XCircle } from 'lucide-react';
import { setNote } from '@/app/runSession';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { formatINR } from '@/core/money';
import { plural } from '@/lib/plural';
import type { CheckLevel, CheckResult } from '@/core/types';

type Props = {
  checks: readonly CheckResult[];
  notes: Readonly<Record<string, string>>;
  /** A Final run cannot be changed, notes included. */
  readOnly: boolean;
};

const ORDER: CheckLevel[] = ['Fail', 'Warning', 'Pass'];
const HEADINGS: Record<CheckLevel, string> = {
  Fail: 'Must be fixed before the month can be Final',
  Warning: 'Needs a note before the month can be Final',
  Pass: 'Looked at, and fine',
};

const ICONS = {
  Fail: <XCircle className="size-4 shrink-0 text-destructive" aria-hidden />,
  Warning: <TriangleAlert className="size-4 shrink-0 text-amber-600" aria-hidden />,
  Pass: <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden />,
} as const;

/** Checks grouped by level. Each opens to show its details and example rows; a Warning takes a typed note. */
export function ChecksPanel({ checks, notes, readOnly }: Props) {
  return (
    <div className="space-y-6">
      {ORDER.map((level) => {
        const list = checks.filter((c) => c.level === level);
        if (list.length === 0) return null;
        return (
          <section key={level} aria-label={`${level} checks`} className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              {ICONS[level]}
              {level === 'Pass' ? 'Passed' : level === 'Warning' ? 'Warnings' : 'Failed'} ({list.length})
              <span className="font-normal text-muted-foreground">{HEADINGS[level]}</span>
            </h3>
            <ul className="divide-y rounded-lg border">
              {list.map((c) => (
                <CheckRow key={c.id} check={c} note={notes[c.id] ?? c.note ?? ''} readOnly={readOnly} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function CheckRow({ check: c, note, readOnly }: { check: CheckResult; note: string; readOnly: boolean }) {
  const expandable = (c.details?.length ?? 0) > 0 || c.examples.length > 0 || c.level === 'Warning';
  const needsNote = c.level === 'Warning' && note.trim() === '';

  const summary = (
    <div className="flex w-full items-start gap-3">
      <span className="mt-0.5">{ICONS[c.level]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{c.title}</span>
          {c.rows !== undefined && c.rows > 0 && <Badge variant="secondary">{plural(c.rows, 'row')}</Badge>}
          {c.amountPaise !== undefined && c.amountPaise !== 0 && <Badge variant="secondary">{formatINR(c.amountPaise)}</Badge>}
          {needsNote && !readOnly && <Badge variant="outline">note needed</Badge>}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{c.message}</p>
      </div>
    </div>
  );

  if (!expandable) return <li className="px-4 py-3">{summary}</li>;

  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-2 px-4 py-3 hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
          {summary}
        </summary>
        <div className="space-y-3 border-t bg-muted/20 px-4 py-3 pl-11">
          {c.details && c.details.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-sm">
              {c.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
          {c.examples.length > 0 && (
            <table className="w-full max-w-2xl text-left text-xs">
              <caption className="pb-1 text-left text-muted-foreground">Example rows</caption>
              <thead>
                <tr className="text-muted-foreground">
                  <th className="pr-4 font-medium">File</th>
                  <th className="pr-4 font-medium">Row</th>
                  <th className="font-medium">Number</th>
                </tr>
              </thead>
              <tbody>
                {c.examples.map((e, i) => (
                  <tr key={i}>
                    <td className="pr-4">{e.sourceFile}</td>
                    <td className="pr-4">{e.sourceRow}</td>
                    <td>{e.ref ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {c.level === 'Warning' && (
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Your note (required for Final)</span>
              <Textarea
                value={note}
                disabled={readOnly}
                onChange={(e) => setNote(c.id, e.target.value)}
                placeholder="Why is this acceptable?"
                aria-label={`Note for: ${c.title}`}
                rows={2}
              />
            </label>
          )}
        </div>
      </details>
    </li>
  );
}
