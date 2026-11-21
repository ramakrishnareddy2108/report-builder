import { FileSpreadsheet, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReportKind } from '@/core/measures';
import { TEMPLATE_LABELS, templateSizes, writeTemplate } from '@/storage/templates';
import type { Workspace } from '@/storage/workspace';
import { inspectTemplateInWorker } from '@/worker/client';

const KINDS: ReportKind[] = ['drr', 'sponsor'];
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024)).toLocaleString('en-IN')} KB`;

/** Upload or replace the two report templates. A file that does not fit is refused before it is saved. */
export function TemplatesCard({ ws }: { ws: Workspace }) {
  const [sizes, setSizes] = useState<Record<ReportKind, number | null> | null>(null);
  const [busy, setBusy] = useState<ReportKind | null>(null);
  const [problem, setProblem] = useState<{ kind: ReportKind; message: string } | null>(null);
  const inputs = useRef<Partial<Record<ReportKind, HTMLInputElement | null>>>({});

  const refresh = useCallback(async () => setSizes(await templateSizes(ws)), [ws]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function upload(kind: ReportKind, file: File) {
    setBusy(kind);
    setProblem(null);
    try {
      const bytes = await file.arrayBuffer();
      const inspected = await inspectTemplateInWorker({ kind, bytes });
      if (!inspected.ok) {
        setProblem({ kind, message: inspected.message });
        return;
      }
      await writeTemplate(ws, kind, bytes);
      toast.success(`${TEMPLATE_LABELS[kind]} template saved (header on row ${inspected.headerRow}, ${inspected.columns} columns, rows ${inspected.firstDataRow} to ${inspected.lastTemplateRow} pre-made).`);
      await refresh();
    } catch (err) {
      setProblem({ kind, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Report templates</CardTitle>
        <CardDescription>
          The Excel files the reports are filled into. Use the originals: the tool writes into their table and keeps their
          formatting and formulas.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-lg border" aria-label="Report templates">
          {KINDS.map((kind) => (
            <li key={kind} className="space-y-1.5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden />
                <span className="text-sm font-medium">{TEMPLATE_LABELS[kind]}</span>
                {sizes && (sizes[kind] === null ? <Badge variant="destructive">Not uploaded</Badge> : <Badge variant="default">Uploaded · {kb(sizes[kind] as number)}</Badge>)}
                <Button
                  className="ml-auto"
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => inputs.current[kind]?.click()}
                >
                  <Upload />
                  {busy === kind ? 'Checking…' : sizes?.[kind] === null ? 'Upload' : 'Replace'}
                </Button>
                <input
                  ref={(el) => {
                    inputs.current[kind] = el;
                  }}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  aria-label={`Choose the ${TEMPLATE_LABELS[kind]} template`}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(kind, f);
                    e.target.value = '';
                  }}
                />
              </div>
              {problem?.kind === kind && (
                <p className="text-sm text-destructive" role="alert">
                  {problem.message} The file was not saved.
                </p>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
