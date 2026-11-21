import { CheckCircle2, FileSpreadsheet, Loader2, TriangleAlert, Upload, XCircle } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { SOURCE_LABELS } from '@/core/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { readFileInWorker } from '@/worker/client';
import type { TaskProgress } from '@/worker/protocol';
import type { ReadFileResult } from '@/worker/tasks/readFile';

/** What the card keeps per file: a summary only, not the rows (patient data stays out of state). */
type Summary = Pick<ReadFileResult, 'identification' | 'sheet' | 'sha256' | 'readMs'> & {
  headerRow: number | null;
  rowCount: number;
  columnCount: number;
  formulaCellsWithoutValue: number;
  sheetCount: number;
};

type Item = {
  key: string;
  name: string;
  status: 'waiting' | 'reading' | 'done' | 'error';
  progress: TaskProgress | null;
  summary?: Summary;
  error?: string;
};

const CONFIRM_BELOW = 0.6;

function summarise(r: ReadFileResult): Summary {
  return {
    identification: r.identification,
    sheet: r.sheet,
    sha256: r.sha256,
    readMs: r.readMs,
    headerRow: r.header?.headerRow ?? null,
    rowCount: r.data?.rowCount ?? 0,
    columnCount: r.data?.columnCount ?? 0,
    formulaCellsWithoutValue: r.data?.stats.formulaCellsWithoutValue ?? 0,
    sheetCount: r.sheets.length,
  };
}

/**
 * Drop or pick HIS exports; each is read in the background worker with
 * progress, then identified as one of the 8 sources.
 */
export function ReadFilesCard() {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const update = (key: string, patch: Partial<Item>) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => /\.(xlsx|xlsm|xls)$/i.test(f.name));
    const added = list.map((file) => ({
      file,
      item: { key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`, name: file.name, status: 'waiting', progress: null } as Item,
    }));
    setItems((prev) => [...added.map((a) => a.item), ...prev]);
    // One file at a time keeps memory low and progress easy to follow.
    for (const { file, item } of added) {
      queue.current = queue.current.then(async () => {
        update(item.key, { status: 'reading' });
        try {
          const result = await readFileInWorker({ file }, (progress) => update(item.key, { progress }));
          update(item.key, { status: 'done', summary: summarise(result) });
        } catch (err) {
          update(item.key, { status: 'error', error: err instanceof Error ? err.message : String(err) });
        }
      });
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Read files</CardTitle>
        <CardDescription>
          Drop this month’s HIS Excel exports to check that each one is recognised. Files are read on this laptop
          only; nothing is uploaded.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-8 text-center transition-colors ${dragging ? 'border-primary bg-muted' : ''}`}
        >
          <Upload className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Drag Excel files here, or</p>
          <Button variant="outline" onClick={() => inputRef.current?.click()}>
            Choose files
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".xlsx,.xlsm,.xls"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {items.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {items.map((it) => (
              <FileRow key={it.key} item={it} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function FileRow({ item }: { item: Item }) {
  const { summary: s } = item;
  const id = s?.identification;
  const needsConfirm = id !== undefined && (id.sourceId === null || id.confidence < CONFIRM_BELOW);

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-center gap-3">
        {item.status === 'done' && !needsConfirm && <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />}
        {item.status === 'done' && needsConfirm && <TriangleAlert className="size-4 shrink-0 text-amber-600" />}
        {item.status === 'error' && <XCircle className="size-4 shrink-0 text-destructive" />}
        {item.status === 'reading' && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
        {item.status === 'waiting' && <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={item.name}>
          {item.name}
        </span>
        {id && (
          <Badge variant={needsConfirm ? 'outline' : 'secondary'}>
            {id.sourceId ? SOURCE_LABELS[id.sourceId] : 'Unknown source'} · {Math.round(id.confidence * 100)}%
          </Badge>
        )}
      </div>

      {item.status === 'waiting' && <p className="text-xs text-muted-foreground">Waiting…</p>}

      {item.status === 'reading' && (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${Math.round((item.progress?.fraction ?? 0) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {item.progress?.stage ?? 'Starting'}
            {item.progress?.detail ? ` — ${item.progress.detail}` : '…'}
          </p>
        </div>
      )}

      {item.status === 'error' && <p className="text-sm text-destructive">{item.error}</p>}

      {s && id && (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{id.reason}</p>
          <p>
            Sheet “{s.sheet ?? '—'}” ({s.sheetCount} in file) · header on row {s.headerRow ?? '—'} ·{' '}
            {s.rowCount.toLocaleString('en-IN')} rows × {s.columnCount} columns · read in{' '}
            {(s.readMs / 1000).toFixed(1)} s · fingerprint {s.sha256.slice(0, 12)}…
          </p>
          {s.formulaCellsWithoutValue > 0 && (
            <p className="text-amber-700">
              {s.formulaCellsWithoutValue} formula cells have no saved value and will read as blank. Open the file
              in Excel, save it, and load it again.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
