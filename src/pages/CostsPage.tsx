import { Copy, FileUp, FolderOpen, Save, Stethoscope } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useOperatorName } from '@/app/operator';
import { useAppStore } from '@/app/store';
import { useSettings } from '@/app/settingsStore';
import { useWorkspace } from '@/app/useWorkspace';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CostsGrid } from '@/components/costs/CostsGrid';
import { CostsImportDialog } from '@/components/costs/CostsImportDialog';
import { EmptyState } from '@/components/EmptyState';
import { MonthPicker } from '@/components/MonthPicker';
import { PageHeader } from '@/components/PageHeader';
import { SettingsGate } from '@/components/SettingsGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { anyAmounts, applyImport, costRows, orphanEntries, setEntry, toEntries, type CostImportResult, type CostRow } from '@/core/costs';
import { defaultReportMonth, previousMonth } from '@/core/dates';
import type { CostEntry } from '@/core/types';
import { plural } from '@/lib/plural';
import { useUnsavedWarning } from '@/lib/useUnsavedWarning';
import { readCostsDraft, readCostsToCopy, writeCostsDraft } from '@/storage/costs';
import type { Workspace } from '@/storage/workspace';

export function CostsPage() {
  const ws = useWorkspace();
  const header = (
    <PageHeader
      title="Costs"
      description="Departmental issues, salary, incentives and professional fee for each doctor, entered once a month."
    />
  );
  if (!ws) {
    return (
      <>
        {header}
        <EmptyState
          icon={FolderOpen}
          title="Choose a workspace folder first"
          description="Costs are saved in the workspace folder. Open the Workspace page to choose it."
        />
      </>
    );
  }
  return (
    <>
      {header}
      <SettingsGate>
        <CostsEditor ws={ws} />
      </SettingsGate>
    </>
  );
}

function CostsEditor({ ws }: { ws: Workspace }) {
  const doctors = useSettings((s) => s.doctors.doctors);
  const setPage = useAppStore((s) => s.setPage);
  const [month, setMonth] = useState(defaultReportMonth);
  const [pendingMonth, setPendingMonth] = useState<string | null>(null);
  const [entries, setEntries] = useState<CostEntry[]>([]);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savedInfo, setSavedInfo] = useState<{ by: string; at: string } | null>(null);
  const [operator, setOperator] = useOperatorName();
  const [importFile, setImportFile] = useState<File | null>(null);
  const [confirmCopy, setConfirmCopy] = useState<CostEntry[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const operatorInput = useRef<HTMLInputElement>(null);

  useUnsavedWarning(dirty);
  const rows = useMemo<CostRow[]>(() => costRows(doctors, entries), [doctors, entries]);
  const orphans = useMemo(() => orphanEntries(doctors, entries), [doctors, entries]);

  // Load the draft of the chosen month.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    readCostsDraft(ws, month)
      .then((file) => {
        if (cancelled) return;
        setEntries(file?.entries ?? []);
        setSavedInfo(file ? { by: file.operatorName, at: file.updatedAt } : null);
        setDirty(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setEntries([]);
        toast.error(`Could not read the saved costs: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ws, month]);

  const onChange = useCallback((doctorId: string, patch: Partial<Pick<CostRow, 'amounts' | 'note'>>) => {
    setEntries((list) => setEntry(list, doctorId, patch));
    setDirty(true);
  }, []);

  function changeMonth(next: string) {
    if (next === month) return;
    if (dirty) setPendingMonth(next);
    else setMonth(next);
  }

  async function save() {
    if (operator.trim() === '') {
      toast.error('Enter your name before saving, so the change can be traced.');
      operatorInput.current?.focus();
      return;
    }
    try {
      const file = await writeCostsDraft(ws, { month, operatorName: operator.trim(), entries });
      setSavedInfo({ by: file.operatorName, at: file.updatedAt });
      setDirty(false);
      toast.success(`Costs for ${month} saved.`);
    } catch (err) {
      toast.error(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function copyFromPrevious() {
    const from = previousMonth(month);
    try {
      const file = await readCostsToCopy(ws, from);
      if (!file || file.entries.length === 0) {
        toast.error(`No costs were saved for ${from}, so there is nothing to copy.`);
        return;
      }
      // Amounts only: a note belongs to the change that was made in that month.
      const copied = file.entries
        .filter((e) => Object.keys(e.amounts).length > 0)
        .map((e): CostEntry => ({ doctorId: e.doctorId, amounts: { ...e.amounts } }));
      if (anyAmounts(rows)) setConfirmCopy(copied);
      else applyCopy(copied, from);
    } catch (err) {
      toast.error(`Could not read the costs of ${from}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function applyCopy(copied: CostEntry[], from = previousMonth(month)) {
    setEntries(copied);
    setDirty(true);
    toast.success(`Copied the costs of ${from}. Check them, then save.`);
  }

  function applyImportResult(result: CostImportResult) {
    const next = applyImport(rows, result.amounts);
    setEntries(toEntries(next, orphans));
    setDirty(true);
    setImportFile(null);
    toast.success(`Imported costs for ${plural(result.amounts.size, 'doctor')}. Check them, then save.`);
  }

  if (doctors.length === 0) {
    return (
      <EmptyState
        icon={Stethoscope}
        title="Add doctors first"
        description="Costs are entered for each doctor in the doctor list, and that list is empty."
        action={<Button onClick={() => setPage('doctors')}>Go to Doctors</Button>}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <MonthPicker value={month} onChange={changeMonth} />
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Your name</span>
          <Input
            ref={operatorInput}
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            placeholder="Who is entering these?"
            className="w-52"
          />
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void copyFromPrevious()} disabled={loading}>
            <Copy />
            Copy from {previousMonth(month)}
          </Button>
          <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={loading}>
            <FileUp />
            Import from Excel
          </Button>
          <Button onClick={() => void save()} disabled={loading || !dirty}>
            <Save />
            Save
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xlsm,.xls"
            className="hidden"
            aria-label="Choose a costs Excel file"
            onChange={(e) => {
              setImportFile(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {dirty
          ? 'You have unsaved changes.'
          : savedInfo
            ? `Saved by ${savedInfo.by} on ${new Date(savedInfo.at).toLocaleString('en-IN')}.`
            : `Nothing saved yet for ${month}. A cost left blank counts as 0 in the report.`}
      </p>

      {orphans.length > 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {plural(orphans.length, 'saved cost row')} belong{orphans.length === 1 ? 's' : ''} to doctors who are no longer in the
          doctor list. They are kept in the file but not shown here.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <CostsGrid doctors={doctors} rows={rows} onChange={onChange} />
      )}
      <p className="text-xs text-muted-foreground">
        Type amounts in rupees (for example 12500 or 12,500.50). Press Enter to move down and Tab to move across.
      </p>

      <CostsImportDialog file={importFile} doctors={doctors} onClose={() => setImportFile(null)} onApply={applyImportResult} />

      <ConfirmDialog
        open={pendingMonth !== null}
        title="Leave without saving?"
        description={`The costs for ${month} have changes that are not saved. Switching to another month discards them.`}
        confirmLabel="Discard and switch"
        destructive
        onCancel={() => setPendingMonth(null)}
        onConfirm={() => {
          if (pendingMonth) setMonth(pendingMonth);
          setPendingMonth(null);
        }}
      />
      <ConfirmDialog
        open={confirmCopy !== null}
        title={`Replace the amounts with ${previousMonth(month)}?`}
        description="The amounts now in the table will be replaced. Nothing is saved until you press Save."
        confirmLabel="Replace"
        onCancel={() => setConfirmCopy(null)}
        onConfirm={() => {
          if (confirmCopy) applyCopy(confirmCopy);
          setConfirmCopy(null);
        }}
      />
    </div>
  );
}
