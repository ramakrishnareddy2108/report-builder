import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { importPastDrr, readPastDrr } from '@/app/monthActions';
import { useOperatorName } from '@/app/operator';
import { MonthPicker } from '@/components/MonthPicker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { defaultReportMonth, previousMonth } from '@/core/dates';
import { formatINR, sumPaise } from '@/core/money';
import { plural } from '@/lib/plural';
import type { Workspace } from '@/storage/workspace';
import type { ReadReportResult } from '@/worker/tasks/reports';

type Props = {
  ws: Workspace;
  file: File | null;
  /** Months that already have a run (an import is refused for those). */
  takenMonths: readonly string[];
  onClose: () => void;
  onImported: () => void;
};

/** Read a filled past DRR and save it as a summary month, so trends can start earlier. */
export function ImportDrrDialog({ ws, file, takenMonths, onClose, onImported }: Props) {
  const [read, setRead] = useState<ReadReportResult | null>(null);
  const [month, setMonth] = useState(() => previousMonth(defaultReportMonth()));
  const [operator, setOperator] = useOperatorName();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setRead(null);
    readPastDrr(file)
      .then((r) => !cancelled && setRead(r))
      .catch((err: unknown) => !cancelled && setRead({ ok: false, message: err instanceof Error ? err.message : String(err) }));
    return () => {
      cancelled = true;
    };
  }, [file]);

  const taken = takenMonths.includes(month);
  const total = read?.ok ? sumPaise(read.rows.map((r) => r.values.TOTAL_REVENUE ?? 0)) : 0;
  const canImport = read?.ok === true && !taken && operator.trim() !== '' && !saving;

  async function save() {
    if (!file || !read?.ok) return;
    setSaving(true);
    try {
      await importPastDrr(ws, { month, fileName: file.name, read, operatorName: operator });
      toast.success(`${month} imported as a summary month (${plural(read.rows.length, 'row')}).`);
      onImported();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={file !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import a past DRR</DialogTitle>
          <DialogDescription>
            {file?.name}. The doctor rows become a summary month (no bill-level detail), so comparisons and trends can reach further
            back. It is saved as a Final month and cannot be changed.
          </DialogDescription>
        </DialogHeader>

        {!read && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Reading the file…
          </p>
        )}
        {read && !read.ok && (
          <p className="text-sm text-destructive" role="alert">
            {read.message}
          </p>
        )}
        {read?.ok && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
              <p>
                <strong>{plural(read.rows.length, 'row')}</strong> read. Total Revenue in the file: <strong>{formatINR(total)}</strong>.
              </p>
              {read.inconsistentRows.length > 0 && (
                <p className="mt-1 text-amber-700">
                  {plural(read.inconsistentRows.length, 'row')} ha{read.inconsistentRows.length === 1 ? 's' : 've'} a Total Revenue or Gross Profit that is
                  not the sum of its columns (for example {read.inconsistentRows.slice(0, 3).join(', ')}). The columns are used; the totals are recalculated.
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <MonthPicker value={month} onChange={setMonth} label="Which month is it?" />
              <label className="flex items-center gap-2 text-sm">
                <span className="font-medium">Your name</span>
                <Input value={operator} onChange={(e) => setOperator(e.target.value)} className="w-48" placeholder="Who is importing?" />
              </label>
            </div>
            {taken && (
              <p className="text-sm text-destructive" role="alert">
                {month} already has a saved run, so it cannot be replaced by an import. Choose a month you never ran here.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canImport} onClick={() => void save()}>
            {saving ? 'Importing…' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
