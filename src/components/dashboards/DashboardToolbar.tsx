import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Dashboard, DashboardsFile, MonthRange } from '@/core/schemas';
import { PickList } from './PickList';

type Props = {
  file: DashboardsFile;
  dashboard: Dashboard;
  /** Months that have a Final run, oldest first (for the range choices). */
  finalMonths: readonly string[];
  choices: Record<'departments' | 'sponsors', string[]>;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (name: string) => void;
  onDuplicate: (name: string) => void;
  onDelete: () => void;
  onChange: (patch: Partial<Pick<Dashboard, 'months' | 'departments' | 'sponsors'>>) => void;
  onAddTile: () => void;
};

type NameDialog = { kind: 'new' | 'rename' | 'duplicate'; value: string } | null;
const TITLES = { new: 'New dashboard', rename: 'Rename the dashboard', duplicate: 'Duplicate the dashboard' } as const;

const MODE_LABELS: Record<MonthRange['mode'], string> = {
  latest: 'Newest Final month',
  last: 'Last months',
  all: 'All Final months',
  range: 'From – to',
};

const options = (names: readonly string[]) => names.map((n) => ({ value: n, label: n }));

/** Choose, create, rename, duplicate and delete dashboards; set their months and global filters. */
export function DashboardToolbar({ file, dashboard, finalMonths, choices, onSelect, onCreate, onRename, onDuplicate, onDelete, onChange, onAddTile }: Props) {
  const [dialog, setDialog] = useState<NameDialog>(null);
  const [deleting, setDeleting] = useState(false);
  const range = dashboard.months;

  function setMode(mode: MonthRange['mode']) {
    const first = finalMonths[0] ?? '2026-01';
    const last = finalMonths.at(-1) ?? first;
    onChange({
      months:
        mode === 'last' ? { mode, count: 12 } : mode === 'range' ? { mode, from: range.mode === 'range' ? range.from : first, to: range.mode === 'range' ? range.to : last } : { mode },
    });
  }

  function confirmName() {
    if (!dialog || dialog.value.trim() === '') return;
    const name = dialog.value.trim();
    (dialog.kind === 'new' ? onCreate : dialog.kind === 'rename' ? onRename : onDuplicate)(name);
    setDialog(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={dashboard.id} onValueChange={onSelect}>
          <SelectTrigger className="w-72" aria-label="Dashboard">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {file.dashboards.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'new', value: '' })}>
          <Plus />
          New
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'rename', value: dashboard.name })}>
          <Pencil />
          Rename
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'duplicate', value: `${dashboard.name} copy` })}>
          <Copy />
          Duplicate
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDeleting(true)}>
          <Trash2 />
          Delete
        </Button>
        <Button size="sm" className="ml-auto" onClick={onAddTile}>
          <Plus />
          Add tile
        </Button>
      </div>

      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-lg border bg-muted/30 px-3 py-2.5" aria-label="Dashboard filters">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Months</span>
          <Select value={range.mode} onValueChange={(v) => setMode(v as MonthRange['mode'])}>
            <SelectTrigger className="w-48" aria-label="Months">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MODE_LABELS) as MonthRange['mode'][]).map((m) => (
                <SelectItem key={m} value={m}>
                  {MODE_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {range.mode === 'last' && (
          <Input
            type="number"
            min={1}
            max={60}
            className="w-20"
            value={range.count}
            aria-label="How many months"
            onChange={(e) => onChange({ months: { mode: 'last', count: Math.max(1, Math.min(60, Math.trunc(Number(e.target.value)) || 1)) } })}
          />
        )}
        {range.mode === 'range' && (
          <span className="flex items-center gap-2 text-sm">
            <MonthSelect label="From" value={range.from} months={finalMonths} onChange={(from) => onChange({ months: { mode: 'range', from, to: range.to < from ? from : range.to } })} />
            <MonthSelect label="To" value={range.to} months={finalMonths} onChange={(to) => onChange({ months: { mode: 'range', from: range.from > to ? to : range.from, to } })} />
          </span>
        )}
        <div className="min-w-56 flex-1">
          <PickList label="Departments" empty="All departments" options={options(choices.departments)} selected={dashboard.departments} onChange={(departments) => onChange({ departments })} />
        </div>
        <div className="min-w-56 flex-1">
          <PickList label="Sponsors" empty="All sponsors" options={options(choices.sponsors)} selected={dashboard.sponsors} onChange={(sponsors) => onChange({ sponsors })} />
        </div>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog ? TITLES[dialog.kind] : ''}</DialogTitle>
            <DialogDescription>Give the dashboard a name you will recognise.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={dialog?.value ?? ''}
            onChange={(e) => setDialog((d) => (d ? { ...d, value: e.target.value } : d))}
            onKeyDown={(e) => e.key === 'Enter' && confirmName()}
            aria-label="Dashboard name"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button disabled={(dialog?.value.trim() ?? '') === ''} onClick={confirmName}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting}
        title={`Delete “${dashboard.name}”?`}
        description="The dashboard and its tiles are removed. Your saved months are not touched."
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false);
          onDelete();
        }}
      />
    </div>
  );
}

function MonthSelect({ label, value, months, onChange }: { label: string; value: string; months: readonly string[]; onChange: (m: string) => void }) {
  const all = months.includes(value) ? months : [...months, value].sort();
  return (
    <label className="flex items-center gap-1.5">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-32" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {all.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
