import { CheckCircle2, FileSpreadsheet, Loader2, TriangleAlert, X, XCircle } from 'lucide-react';
import { assignSource, CONFIRM_BELOW } from '@/app/fileLoader';
import { useFiles, type LoadedFile } from '@/app/filesStore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SOURCE_IDS, SOURCE_LABELS, type SourceId } from '@/core/types';

const NONE = '__none__';

/** The files loaded this session, with the source each one is used as. */
export function LoadedFilesList() {
  const files = useFiles((s) => s.files);
  if (files.length === 0) return null;
  return (
    <ul className="divide-y rounded-lg border" aria-label="Loaded files">
      {files.map((f) => (
        <FileRow key={f.id} item={f} />
      ))}
    </ul>
  );
}

function FileRow({ item }: { item: LoadedFile }) {
  const remove = useFiles((s) => s.remove);
  const id = item.identification;
  const needsChoice = item.state === 'ready' && item.sourceId === null;
  const duplicateOf = useFiles((s) =>
    item.sha256 ? s.files.find((o) => o.id !== item.id && o.sha256 === item.sha256) : undefined,
  );

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-center gap-3">
        {item.state === 'ready' && !needsChoice && <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />}
        {item.state === 'ready' && needsChoice && <TriangleAlert className="size-4 shrink-0 text-amber-600" />}
        {item.state === 'error' && <XCircle className="size-4 shrink-0 text-destructive" />}
        {item.state === 'reading' && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={item.file.name}>
          <FileSpreadsheet className="mr-1.5 inline size-3.5 text-muted-foreground" />
          {item.file.name}
        </span>
        {item.state === 'ready' && (
          <Select value={item.sourceId ?? NONE} onValueChange={(v) => void assignSource(item.id, v === NONE ? null : (v as SourceId))}>
            <SelectTrigger className="w-56" aria-label={`Source for ${item.file.name}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Choose the source…</SelectItem>
              {SOURCE_IDS.map((s) => (
                <SelectItem key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {id && item.sourceId && (
          <Badge variant="secondary">{Math.round(id.confidence * 100)}% sure</Badge>
        )}
        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${item.file.name}`} onClick={() => remove(item.id)}>
          <X />
        </Button>
      </div>

      {item.state === 'reading' && (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round((item.progress?.fraction ?? 0) * 100)}>
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${Math.round((item.progress?.fraction ?? 0) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {item.progress?.stage ?? 'Waiting'}
            {item.progress?.detail ? ` — ${item.progress.detail}` : '…'}
          </p>
        </div>
      )}
      {item.state === 'error' && <p className="text-sm text-destructive">{item.error}</p>}
      {needsChoice && (
        <p className="text-xs text-amber-700">
          {id && id.confidence > 0 && id.confidence < CONFIRM_BELOW ? `${id.reason} ` : 'This file was not recognised. '}
          Please choose which source it is.
        </p>
      )}
      {duplicateOf && (
        <p className="text-xs text-destructive">
          This file is identical to “{duplicateOf.file.name}”. Remove one of them: the same file cannot be used twice.
        </p>
      )}
      {item.formulaCellsWithoutValue > 0 && (
        <p className="text-xs text-amber-700">
          {item.formulaCellsWithoutValue} formula cells have no saved value and will read as blank. Open the file in
          Excel, save it, and load it again.
        </p>
      )}
    </li>
  );
}
