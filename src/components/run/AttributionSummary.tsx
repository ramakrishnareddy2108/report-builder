import { useMemo } from 'react';
import { formatINR } from '@/core/money';
import { plural } from '@/lib/plural';
import type { AttributionStatus, CheckResult, FactRow } from '@/core/types';

const STATUSES: { status: AttributionStatus; meaning: string }[] = [
  { status: 'Matched', meaning: 'The patient had exactly one consultation in the month.' },
  { status: 'Fallback', meaning: 'Several consultations: the latest on or before the bill date was used (else the earliest after).' },
  { status: 'Unattributed', meaning: 'No consultation found; shown under “Pharmacy – Unattributed”.' },
];

const METHOD_TEXT: Record<string, string> = {
  'single-consultation': 'one consultation',
  'latest-consultation-before-bill': 'latest consultation on or before the bill',
  'earliest-consultation-after-bill': 'earliest consultation after the bill',
  'first-consultation-no-date': 'first consultation (no readable dates)',
  'first-consultation-no-bill-date': 'first consultation (bill has no readable date)',
  'no-consultation': 'no consultation',
};

/** How OP pharmacy sales were linked to doctors, and the in-patient rows kept apart. */
export function AttributionSummary({ facts, checks }: { facts: readonly FactRow[]; checks: readonly CheckResult[] }) {
  const { byStatus, byMethod, total } = useMemo(() => {
    // OP_PHARMACY only: its cost comes from the same rows and must not be counted again.
    const rows = facts.filter((f) => f.measure === 'OP_PHARMACY' && f.attributionStatus !== undefined);
    const byStatus = new Map<AttributionStatus, { rows: number; paise: number }>();
    const byMethod = new Map<string, number>();
    let paise = 0;
    for (const f of rows) {
      const s = byStatus.get(f.attributionStatus as AttributionStatus) ?? { rows: 0, paise: 0 };
      s.rows++;
      s.paise += f.amountPaise;
      byStatus.set(f.attributionStatus as AttributionStatus, s);
      byMethod.set(f.attributionMethod ?? '', (byMethod.get(f.attributionMethod ?? '') ?? 0) + 1);
      paise += f.amountPaise;
    }
    return { byStatus, byMethod, total: { rows: rows.length, paise } };
  }, [facts]);

  const ipViaOp = checks.find((c) => c.id === 'ip-via-op-pharmacy');

  if (total.rows === 0 && !ipViaOp?.rows) {
    return <p className="text-sm text-muted-foreground">This run has no OP pharmacy rows.</p>;
  }

  return (
    <div className="space-y-5">
      <table className="w-full max-w-3xl text-sm">
        <caption className="pb-2 text-left text-muted-foreground">
          OP pharmacy net sales (sales less returns): {plural(total.rows, 'row')}, {formatINR(total.paise)}
        </caption>
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-1.5 pr-4 font-medium">Status</th>
            <th className="py-1.5 pr-4 text-right font-medium">Rows</th>
            <th className="py-1.5 pr-4 text-right font-medium">Amount</th>
            <th className="py-1.5 font-medium">Meaning</th>
          </tr>
        </thead>
        <tbody>
          {STATUSES.map(({ status, meaning }) => (
            <tr key={status} className="border-b">
              <td className="py-1.5 pr-4 font-medium">{status}</td>
              <td className="py-1.5 pr-4 text-right tabular-nums">{(byStatus.get(status)?.rows ?? 0).toLocaleString('en-IN')}</td>
              <td className="py-1.5 pr-4 text-right tabular-nums">{formatINR(byStatus.get(status)?.paise ?? 0)}</td>
              <td className="py-1.5 text-muted-foreground">{meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {byMethod.size > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-medium">How doctors were found</h4>
          <ul className="space-y-0.5 text-sm text-muted-foreground">
            {[...byMethod].sort((a, b) => b[1] - a[1]).map(([method, n]) => (
              <li key={method}>
                {plural(n, 'row')}: {METHOD_TEXT[method] ?? method}
              </li>
            ))}
          </ul>
        </div>
      )}

      {ipViaOp && (
        <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <h4 className="font-medium">In-patients at the OP pharmacy counter</h4>
          <p className="mt-0.5 text-muted-foreground">{ipViaOp.message}</p>
          {ipViaOp.details?.map((d, i) => (
            <p key={i} className="text-muted-foreground">
              {d}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
