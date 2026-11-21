import type { ColDef } from 'ag-grid-community';
import { Download, Layers } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { formatINR } from '@/core/money';
import { DataGrid } from '@/components/DataGrid';
import { IssueList } from '@/components/IssueList';
import { ProgressBar } from '@/components/ProgressBar';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { CombinedRow } from '@/engine/types';
import { downloadFile, XLSX_MIME } from '@/lib/download';
import { combineInWorker, exportCombinedInWorker } from '@/worker/client';
import type { TaskProgress } from '@/worker/protocol';
import type { CombineTaskResult } from '@/worker/tasks/combine';
import { useBuilder } from './builderStore';

/** The sample files, stacked as the report will see them. A way to check the Sources tab before going on. */
export function CombinedPreview() {
  const recipe = useBuilder((s) => s.recipe);
  const samples = useBuilder((s) => s.samples);
  const [result, setResult] = useState<CombineTaskResult | null>(null);
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = recipe ? recipe.sources.filter((s) => samples[s.id]) : [];

  async function run() {
    if (!recipe) return;
    setError(null);
    setProgress({ stage: 'Starting', fraction: 0 });
    try {
      const params = Object.fromEntries(recipe.parameters.map((p) => [p.name, p.default ?? '']));
      const r = await combineInWorker(
        { recipe, params, assignments: ready.map((s) => ({ sourceId: s.id, file: (samples[s.id] as NonNullable<(typeof samples)[string]>).file })), maxRows: 200 },
        setProgress,
      );
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setProgress(null);
    }
  }

  async function download() {
    try {
      downloadFile('combined-data.xlsx', (await exportCombinedInWorker()) as unknown as BlobPart, XLSX_MIME);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not make the file.');
    }
  }

  const columns = useMemo<ColDef<CombinedRow>[]>(
    () =>
      (result?.table.columns ?? []).map((c) => ({
        headerName: c.name,
        field: c.name,
        minWidth: c.type === 'text' ? 130 : 110,
        type: c.type === 'money' || c.type === 'number' ? 'rightAligned' : undefined,
        valueFormatter: c.type === 'money' ? (p) => (typeof p.value === 'number' ? formatINR(p.value) : '') : undefined,
      })),
    [result],
  );

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="combined-h">
      <div>
        <h3 id="combined-h" className="flex items-center gap-2 text-base font-semibold">
          <Layers className="size-4" aria-hidden /> Check the combined data
        </h3>
        <p className="text-sm text-muted-foreground">Stacks your sample files the way the report will see them. Nothing is saved.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void run()} disabled={ready.length === 0 || progress !== null}>
          Show combined data
        </Button>
        {result && (
          <Button variant="outline" onClick={() => void download()}>
            <Download className="size-4" /> Download combined Excel
          </Button>
        )}
      </div>
      {ready.length === 0 && <p className="text-sm text-muted-foreground">Add a sample file to at least one source first.</p>}
      {progress && <ProgressBar fraction={progress.fraction} label={progress.stage} detail={progress.detail} />}
      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-4">
          <IssueList issues={result.issues} />
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Rows read</TableHead>
                  <TableHead className="text-right">Left out (filter / totals)</TableHead>
                  <TableHead className="text-right">Used</TableHead>
                  <TableHead className="text-right">Unreadable values</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.sources.map((s) => (
                  <TableRow key={s.sourceId}>
                    <TableCell className="font-medium">
                      {s.label}
                      <span className="block text-xs font-normal text-muted-foreground">{s.fileName}</span>
                    </TableCell>
                    <TableCell className="text-right">{s.stats.read.toLocaleString('en-IN')}</TableCell>
                    <TableCell className="text-right">{s.stats.filtered.toLocaleString('en-IN')}</TableCell>
                    <TableCell className="text-right">{s.stats.used.toLocaleString('en-IN')}</TableCell>
                    <TableCell className="text-right">{Object.values(s.stats.unreadableByColumn).reduce((a, b) => a + b, 0).toLocaleString('en-IN')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-sm text-muted-foreground">
            {result.totalRows.toLocaleString('en-IN')} rows in total{result.totalRows > result.table.rows.length ? `, showing the first ${result.table.rows.length}` : ''}.
          </p>
          <div className="overflow-hidden rounded-lg border">
            <DataGrid<CombinedRow> rows={result.table.rows} columns={columns} height={360} />
          </div>
        </div>
      )}
    </section>
  );
}
