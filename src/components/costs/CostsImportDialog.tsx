import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getMeasure } from '@/core/measures';
import { mapCostImport, suggestImportColumns, type CostImportMapping, type CostImportResult } from '@/core/costs';
import { COST_MEASURE_CODES, type CostMeasureCode, type DoctorMaster } from '@/core/types';
import { columnLetter } from '@/excel/detectHeader';
import { readFileInWorker } from '@/worker/client';
import type { ReadFileResult } from '@/worker/tasks/readFile';
import { plural } from '@/lib/plural';

const NONE = '__none__';

type Props = {
  /** The Excel file chosen by the user; the dialog is open while this is set. */
  file: File | null;
  doctors: readonly DoctorMaster[];
  onClose: () => void;
  /** Called with the matched amounts when the user confirms. */
  onApply: (result: CostImportResult) => void;
};

/** Map the columns of a costs workbook, check them against the doctor list, then apply. */
export function CostsImportDialog({ file, doctors, onClose, onApply }: Props) {
  const [read, setRead] = useState<ReadFileResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<CostImportMapping>({ headerRow: 1, doctorColumn: 0, columns: {} });

  // Read the file (the sheet it looks like, header detected), and guess the columns.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setRead(null);
    setError(null);
    readFileInWorker({ file })
      .then((r) => {
        if (cancelled) return;
        setRead(r);
        const guess = suggestImportColumns(r.header?.rawHeaders ?? []);
        setMapping({ headerRow: r.header?.headerRow ?? 1, doctorColumn: guess.doctorColumn ?? 0, columns: guess.columns });
      })
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [file]);

  async function reread(sheet: string | undefined, headerRow: number | undefined) {
    if (!file) return;
    try {
      const r = await readFileInWorker({ file, sheet, headerRow });
      setRead(r);
      const guess = suggestImportColumns(r.header?.rawHeaders ?? []);
      setMapping({ headerRow: r.header?.headerRow ?? headerRow ?? 1, doctorColumn: guess.doctorColumn ?? 0, columns: guess.columns });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const headers = read?.header?.rawHeaders ?? [];
  const result = useMemo(() => (read?.data ? mapCostImport(read.data.rows, mapping, doctors) : null), [read, mapping, doctors]);
  const columnOptions = headers.map((h, i) => ({ value: String(i), label: `${columnLetter(i)} · ${h || '(no header)'}` }));
  const applied = result ? result.amounts.size : 0;
  const mappedCosts = Object.keys(mapping.columns).length;

  const setColumn = (code: CostMeasureCode, v: string) =>
    setMapping((m) => {
      const columns = { ...m.columns };
      if (v === NONE) delete columns[code];
      else columns[code] = Number(v);
      return { ...m, columns };
    });

  return (
    <Dialog open={file !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import costs from Excel</DialogTitle>
          <DialogDescription>
            {file?.name}. Choose which column holds the doctor and which hold each cost. Doctors are matched through the
            doctor list; a name that is not in the list is never added.
          </DialogDescription>
        </DialogHeader>

        {!read && !error && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Reading the file…
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {read && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Sheet</span>
                <Select value={read.sheet ?? ''} onValueChange={(s) => void reread(s, undefined)}>
                  <SelectTrigger aria-label="Sheet">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {read.sheets.map((s) => (
                      <SelectItem key={s.name} value={s.name}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Header row</span>
                <Input
                  key={`${read.sheet}-${mapping.headerRow}`}
                  type="number"
                  min={1}
                  max={50}
                  defaultValue={mapping.headerRow}
                  onBlur={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isInteger(n) && n >= 1 && n !== mapping.headerRow) void reread(read.sheet ?? undefined, n);
                  }}
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <ColumnSelect
                label="Doctor name"
                value={String(mapping.doctorColumn)}
                options={columnOptions}
                onChange={(v) => setMapping((m) => ({ ...m, doctorColumn: Number(v) }))}
              />
              {COST_MEASURE_CODES.map((code) => (
                <ColumnSelect
                  key={code}
                  label={getMeasure(code).label}
                  value={mapping.columns[code] === undefined ? NONE : String(mapping.columns[code])}
                  options={[{ value: NONE, label: 'Not in this file (leave as is)' }, ...columnOptions]}
                  onChange={(v) => setColumn(code, v)}
                />
              ))}
            </div>

            {result && (
              <div className="space-y-1 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
                <p>
                  <strong>{plural(applied, 'doctor')}</strong> matched and ready to import ({plural(result.rowsRead, 'row')} read).
                </p>
                {result.unmatched.length > 0 && (
                  <p className="text-amber-700">
                    {plural(result.unmatched.length, 'name')} not in the doctor list, so not imported:{' '}
                    {result.unmatched.slice(0, 8).map((u) => `“${u.raw}”`).join(', ')}
                    {result.unmatched.length > 8 ? ', …' : ''}
                  </p>
                )}
                {result.duplicates.length > 0 && (
                  <p className="text-destructive">
                    {plural(result.duplicates.length, 'doctor')} listed more than once, so not imported (rows{' '}
                    {result.duplicates.flatMap((d) => d.rows).slice(0, 10).join(', ')}). Fix the file and try again.
                  </p>
                )}
                {result.badCells.length > 0 && (
                  <p className="text-destructive">
                    {plural(result.badCells.length, 'amount')} could not be read, so not imported (row {result.badCells[0]?.row}:{' '}
                    {getMeasure(result.badCells[0]?.cost ?? 'SALARY').label}, “{result.badCells[0]?.raw}”).
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!result || applied === 0 || mappedCosts === 0} onClick={() => result && onApply(result)}>
            Import {applied > 0 ? plural(applied, 'doctor') : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ColumnSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
