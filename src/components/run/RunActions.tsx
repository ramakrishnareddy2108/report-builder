import { CheckCheck, Lock, Save } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useOperatorName } from '@/app/operator';
import { blockers, markFinal, saveDraft, savePlan, useRun } from '@/app/runSession';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Workspace } from '@/storage/workspace';

/** Save Draft and Mark Final. A Final run is read-only; running it again makes a new run with a reason. */
export function RunActions({ ws }: { ws: Workspace }) {
  const result = useRun((s) => s.result);
  const notes = useRun((s) => s.notes);
  const savedRuns = useRun((s) => s.savedRuns);
  const busy = useRun((s) => s.busy);
  const [operator, setOperator] = useOperatorName();
  const [reason, setReason] = useState('');
  const [confirmFinal, setConfirmFinal] = useState(false);
  if (!result) return null;

  if (result.saved?.status === 'Final') {
    return (
      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm" role="status">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          Run {result.saved.runNumber} is <strong>Final</strong> and read-only. To change anything, load the files and run
          the month again: the new run is saved as run {savedRuns.length > 0 ? Math.max(...savedRuns.map((r) => r.runNumber)) + 1 : 2}{' '}
          and needs a reason.
        </p>
      </div>
    );
  }

  const plan = savePlan(savedRuns, result);
  const blocking = blockers(result, notes);
  const fails = result.checks.filter((c) => c.level === 'Fail').length;
  const options = { operatorName: operator, reason };

  async function run(action: () => Promise<number>, done: (n: number) => string) {
    try {
      toast.success(done(await action()));
      setReason('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-3 rounded-lg border px-4 py-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Your name</span>
          <Input value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="Who is saving this?" className="w-52" />
        </label>
        {plan.needsReason && (
          <label className="min-w-64 flex-1 space-y-1 text-sm">
            <span className="font-medium">Why are you running this month again? (required)</span>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: a late bill was added" />
          </label>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" disabled={busy !== null} onClick={() => void run(() => saveDraft(ws, options), (n) => `Saved as Draft run ${n}.`)}>
            <Save />
            {busy === 'saving' ? 'Saving…' : 'Save Draft'}
          </Button>
          <Button disabled={busy !== null || blocking.length > 0} onClick={() => setConfirmFinal(true)}>
            <CheckCheck />
            Mark Final
          </Button>
        </div>
      </div>

      {blocking.length > 0 && (
        <div className="text-sm" aria-live="polite">
          <p className="font-medium text-muted-foreground">Before this month can be Final:</p>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {blocking.slice(0, 6).map((b) => (
              <li key={b}>{b}</li>
            ))}
            {blocking.length > 6 && <li>…and {blocking.length - 6} more</li>}
          </ul>
        </div>
      )}
      {fails === 0 && blocking.length === 0 && <p className="text-sm text-emerald-700">No failed checks, and every warning has a note. This run can be made Final.</p>}

      <ConfirmDialog
        open={confirmFinal}
        title="Make this run Final?"
        description="A Final run cannot be changed afterwards. To correct something later you will have to run the month again, with a reason."
        confirmLabel="Make Final"
        onCancel={() => setConfirmFinal(false)}
        onConfirm={() => {
          setConfirmFinal(false);
          void run(() => markFinal(ws, options), (n) => `Run ${n} is now Final.`);
        }}
      />
    </div>
  );
}
