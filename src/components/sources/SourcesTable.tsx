import { Pencil } from 'lucide-react';
import type { SourceInfo } from '@/app/useSourceInfos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SOURCE_IDS, SOURCE_LABELS, type SourceId } from '@/core/types';
import type { SourceStatus } from '@/excel/sourceStatus';

const BADGE_VARIANT: Record<SourceStatus, 'secondary' | 'default' | 'destructive'> = {
  'Not mapped': 'secondary',
  Ready: 'default',
  Flagged: 'destructive',
};

export function StatusBadge({ status }: { status: SourceStatus }) {
  return <Badge variant={BADGE_VARIANT[status]}>{status}</Badge>;
}

type Props = {
  infos: Record<SourceId, SourceInfo>;
  onEdit: (sourceId: SourceId) => void;
};

/** The 8 sources with their status; Flagged ones list the exact missing columns. */
export function SourcesTable({ infos, onEdit }: Props) {
  return (
    <ul className="divide-y rounded-lg border" aria-label="Sources">
      {SOURCE_IDS.map((id) => {
        const info = infos[id];
        const { status } = info.status;
        return (
          <li key={id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3">
            <div className="min-w-48 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{SOURCE_LABELS[id]}</span>
                <StatusBadge status={status} />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {info.file
                  ? `File: ${info.file.file.name}`
                  : status === 'Not mapped'
                    ? 'Not confirmed yet. Load its file, check the columns and save.'
                    : 'No file loaded this session.'}
              </p>
              {info.status.problems.map((p, i) => (
                <p key={i} className="mt-0.5 text-xs text-destructive">
                  {p.message}
                </p>
              ))}
              {status === 'Ready' && info.status.checkedAgainstFile && (
                <p className="mt-0.5 text-xs text-muted-foreground">The saved mapping fits this file.</p>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => onEdit(id)}>
              <Pencil />
              {status === 'Not mapped' ? 'Set up' : 'Edit mapping'}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
