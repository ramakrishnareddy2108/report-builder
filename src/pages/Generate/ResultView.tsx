import { Download, LayoutDashboard, Layers, Table2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLibrary } from '@/app/libraryStore';
import { useAppStore } from '@/app/store';
import { ChecksPanel } from '@/components/ChecksPanel';
import { ReportGrid } from '@/components/ReportGrid';
import { Button } from '@/components/ui/button';
import type { Check } from '@/engine/checks';
import { downloadFile, XLSX_MIME } from '@/lib/download';
import { exportCombinedInWorker, exportIntermediateInWorker } from '@/worker/client';
import type { GenerateTaskResult } from '@/worker/tasks/generate';
import { reportFileName } from './assignments';

type Props = {
  result: GenerateTaskResult;
  info: { recipeId: string; recipeName: string; period: string };
  onFix: (check: Check) => void;
};

/** What comes after Generate: the checks, the report, and the downloads. */
export function ResultView({ result, info, onFix }: Props) {
  const go = useAppStore((s) => s.go);
  const recipe = useLibrary((s) => s.recipes.find((r) => r.id === info.recipeId));
  const errors = result.checks.filter((c) => c.level === 'error').length;
  const fileName = reportFileName(info.recipeName, info.period);

  async function combined() {
    try {
      const bytes = await exportCombinedInWorker();
      downloadFile(fileName.replace(/\.xlsx$/, '_combined-data.xlsx'), bytes as unknown as BlobPart, XLSX_MIME);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not make the file.');
    }
  }

  async function intermediate() {
    if (!recipe) return;
    try {
      const bytes = await exportIntermediateInWorker({ recipe: { sources: recipe.sources, lookups: recipe.lookups }, sources: result.sources });
      downloadFile(fileName.replace(/\.xlsx$/, '_intermediate.xlsx'), bytes as unknown as BlobPart, XLSX_MIME);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not make the file.');
    }
  }

  return (
    <section className="space-y-6 border-t pt-8" aria-labelledby="result-h">
      <h2 id="result-h" className="text-xl font-semibold">
        {result.canDownload ? 'Your report is ready' : 'The report could not be made yet'}
      </h2>

      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            size="lg"
            disabled={!result.canDownload || !result.workbookBytes}
            onClick={() => result.workbookBytes && downloadFile(fileName, result.workbookBytes as unknown as BlobPart, XLSX_MIME)}
          >
            <Download className="size-5" /> Download report
          </Button>
          <Button size="lg" variant="outline" disabled={!recipe || result.sources.length === 0} onClick={() => void intermediate()}>
            <Table2 className="size-5" /> Download intermediate Excel
          </Button>
          <Button size="lg" variant="outline" disabled={!result.report} onClick={() => void combined()}>
            <Layers className="size-5" /> Download combined data
          </Button>
          <Button size="lg" variant="outline" disabled={!result.canDownload} onClick={() => go({ page: 'dashboards' })}>
            <LayoutDashboard className="size-5" /> Open in dashboard
          </Button>
        </div>
        {result.canDownload && <p className="text-sm text-muted-foreground">File name: {fileName}</p>}
        <p className="text-sm text-muted-foreground">The intermediate Excel has one sheet per file with only the columns you selected, and works even when the report is blocked.</p>
        {!result.canDownload && errors > 0 && <p className="text-sm text-destructive">Fix the {errors} problem{errors === 1 ? '' : 's'} below and generate again. The download is switched off until then.</p>}
      </div>

      <ChecksPanel checks={result.checks} onFix={onFix} />

      {result.report && result.report.columns.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">
            Report preview · {result.report.rows.length.toLocaleString('en-IN')} rows
          </h3>
          <ReportGrid columns={result.report.columns} rows={result.report.rows} totals={result.report.totals} />
        </div>
      )}
    </section>
  );
}
