import { useAppStore } from '@/app/store';
import { useRun } from '@/app/runSession';
import { useSourceInfos, type SourceInfo } from '@/app/useSourceInfos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SOURCE_IDS, SOURCE_LABELS } from '@/core/types';

type Readiness = 'Ready' | 'Flagged' | 'Missing' | 'Not mapped' | 'Not used';

/** What the Run page needs to know about a source. */
export function readiness(info: SourceInfo): Readiness {
  const needed = info.required.size > 0;
  if (!needed) return 'Not used';
  if (!info.file) return 'Missing';
  if (info.status.status === 'Not mapped') return 'Not mapped';
  return info.status.status === 'Flagged' ? 'Flagged' : 'Ready';
}

const VARIANT: Record<Readiness, 'default' | 'destructive' | 'secondary' | 'outline'> = {
  Ready: 'default',
  Flagged: 'destructive',
  Missing: 'destructive',
  'Not mapped': 'destructive',
  'Not used': 'secondary',
};

/** True when every source the rules use has a file that fits its confirmed mapping. */
export function allSourcesReady(infos: Record<string, SourceInfo>): boolean {
  return Object.values(infos).every((i) => ['Ready', 'Not used'].includes(readiness(i)));
}

/** The 8 sources and the month's costs: Ready, Flagged or Missing. */
export function RunStatusPanel() {
  const infos = useSourceInfos();
  const costsEntered = useRun((s) => s.costsEntered);
  const month = useRun((s) => s.month);
  const setPage = useAppStore((s) => s.setPage);

  return (
    <ul className="divide-y rounded-lg border" aria-label="Readiness">
      {SOURCE_IDS.map((id) => {
        const info = infos[id];
        const r = readiness(info);
        return (
          <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
            <span className="w-52 text-sm font-medium">{SOURCE_LABELS[id]}</span>
            <Badge variant={VARIANT[r]}>{r}</Badge>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {info.file ? info.file.file.name : r === 'Not used' ? 'No rule uses this file.' : 'Drop the file above.'}
            </span>
            {info.status.problems.slice(0, 2).map((p, i) => (
              <span key={i} className="basis-full pl-52 text-xs text-destructive">
                {p.message}
              </span>
            ))}
          </li>
        );
      })}
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
        <span className="w-52 text-sm font-medium">Costs for {month}</span>
        <Badge variant={costsEntered ? 'default' : 'outline'}>{costsEntered === null ? 'Checking…' : costsEntered ? 'Entered' : 'Missing'}</Badge>
        <span className="flex-1 text-xs text-muted-foreground">
          {costsEntered ? 'Used in Gross Profit.' : 'Without costs, Gross Profit ignores them (a warning in Checks).'}
        </span>
        <Button variant="ghost" size="sm" onClick={() => setPage('costs')}>
          Open Costs
        </Button>
      </li>
    </ul>
  );
}
