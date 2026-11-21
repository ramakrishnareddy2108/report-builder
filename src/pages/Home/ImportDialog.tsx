import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLibrary } from '@/app/libraryStore';
import { planImport, type ImportMode } from '@/recipe/importExport';

type Props = {
  /** Text of the chosen library file; the dialog is open while this is not null. */
  text: string | null;
  fileName: string;
  onClose: () => void;
};

const STATUS_LABEL = { new: 'New', overwrite: 'Will overwrite', invalid: 'Skipped' } as const;

/** Shows what an import would change before anything is written. */
export function ImportDialog({ text, fileName, onClose }: Props) {
  const recipes = useLibrary((s) => s.recipes);
  const dashboards = useLibrary((s) => s.dashboards);
  const importLibrary = useLibrary((s) => s.importLibrary);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [busy, setBusy] = useState(false);

  const plan = useMemo(() => (text === null ? null : planImport(text, { recipes, dashboards }, mode)), [text, recipes, dashboards, mode]);

  async function run() {
    if (!plan?.ok) return;
    setBusy(true);
    try {
      await importLibrary(plan);
      toast.success(`Imported ${plan.counts.new + plan.counts.overwrite} item${plan.counts.new + plan.counts.overwrite === 1 ? '' : 's'}.`);
      onClose();
    } catch {
      /* the store already showed the reason */
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={text !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import library</DialogTitle>
          <DialogDescription>{fileName}</DialogDescription>
        </DialogHeader>

        {plan && !plan.ok && (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {plan.message}
          </p>
        )}

        {plan?.ok && (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">How should it be added?</legend>
              <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
                <input type="radio" name="mode" className="mt-1" checked={mode === 'merge'} onChange={() => setMode('merge')} />
                <span>
                  <b>Merge</b> (recommended)
                  <br />
                  <span className="text-muted-foreground">Adds new items. Items with the same id are overwritten. Nothing else is touched.</span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
                <input type="radio" name="mode" className="mt-1" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                <span>
                  <b>Replace all</b>
                  <br />
                  <span className="text-muted-foreground">Makes your library match the file. Anything not in the file is removed.</span>
                </span>
              </label>
            </fieldset>

            <p className="text-sm">
              {plan.counts.new} new · {plan.counts.overwrite} will overwrite · {plan.counts.invalid} skipped
              {plan.counts.removed > 0 && <b className="text-destructive"> · {plan.counts.removed} will be removed</b>}
            </p>

            <ul className="max-h-60 divide-y overflow-y-auto rounded-md border text-sm">
              {plan.items.map((item, i) => (
                <li key={`${item.kind}-${item.id ?? i}`} className="flex flex-col gap-1 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">
                      <span className="text-muted-foreground">{item.kind === 'recipe' ? 'Recipe' : 'Dashboard'}: </span>
                      {item.name}
                    </span>
                    <Badge variant={item.status === 'invalid' ? 'destructive' : item.status === 'overwrite' ? 'secondary' : 'default'}>
                      {STATUS_LABEL[item.status]}
                    </Badge>
                  </div>
                  {item.error && <span className="text-xs text-destructive">{item.error}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void run()} disabled={!plan?.ok || busy}>
            {mode === 'replace' ? 'Replace library' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
