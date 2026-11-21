import { FileSpreadsheet, Plus, Table2, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FileDrop } from '@/components/FileDrop';
import { NativeSelect } from '@/components/NativeSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { bytesToBase64 } from '@/lib/base64';
import { cn } from '@/lib/utils';
import type { MappingStatus } from '@/excel/fillTemplate';
import type { OutputDef, Recipe } from '@/recipe/schema';
import { inspectTemplateInWorker } from '@/worker/client';
import type { InspectTemplateResult } from '@/worker/tasks/inspectTemplate';
import { templateProblem } from '../templateGuard';
import { useBuilder } from './builderStore';

type TemplateOutput = Extract<OutputDef, { mode: 'template' }>;

const STATUS: Record<MappingStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  matched: { label: 'Matched', variant: 'default' },
  'formula-kept': { label: 'Formula kept', variant: 'secondary' },
  unmatched: { label: 'Not in template', variant: 'destructive' },
};

const TEMPLATE_WARN_BYTES = 2 * 1024 * 1024;

function ModeCard({ selected, onSelect, icon: Icon, title, text }: { selected: boolean; onSelect: () => void; icon: typeof Table2; title: string; text: string }) {
  return (
    <label className={cn('flex min-h-20 cursor-pointer gap-3 rounded-lg border p-3 text-sm', selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/40')}>
      <input type="radio" name="output-mode" className="mt-1 size-4 accent-primary" checked={selected} onChange={onSelect} />
      <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span>
        <b className="block">{title}</b>
        <span className="text-muted-foreground">{text}</span>
      </span>
    </label>
  );
}

function SafetyChecks() {
  const recipe = useBuilder((s) => s.recipe) as Recipe;
  const update = useBuilder((s) => s.update);
  const sourceCols = (id: string) => {
    const s = recipe.sources.find((x) => x.id === id);
    return s ? [...s.columns.map((c) => c.as), ...s.calculated.map((c) => c.as)] : [];
  };
  const reportNames = recipe.report.columns.map((c) => c.name).filter(Boolean);

  return (
    <section className="space-y-3" aria-labelledby="tie-h">
      <div>
        <h2 id="tie-h" className="text-lg font-medium">
          Safety checks (optional)
        </h2>
        <p className="text-sm text-muted-foreground">Compare a total at the bottom of one of your Excel files with the same total in the report. If they differ, you are told.</p>
      </div>
      {recipe.checks.tieOuts.map((t, i) => (
        <div key={i} className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Input value={t.label} onChange={(e) => update((r) => void ((r.checks.tieOuts[i] as (typeof t))!.label = e.target.value))} aria-label="Name of the check" placeholder="e.g. OP Billing total" />
            <Button variant="ghost" size="icon" aria-label={`Remove ${t.label || 'check'}`} onClick={() => update((r) => void r.checks.tieOuts.splice(i, 1))}>
              <Trash2 className="size-4" />
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            <NativeSelect value={t.source} onChange={(e) => update((r) => void ((r.checks.tieOuts[i] as (typeof t))!.source = e.target.value))} aria-label="Source with the total">
              {recipe.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect value={t.column} onChange={(e) => update((r) => void ((r.checks.tieOuts[i] as (typeof t))!.column = e.target.value))} aria-label="Column holding the total">
              <option value="">Column…</option>
              {sourceCols(t.source).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect value={t.reportColumn} onChange={(e) => update((r) => void ((r.checks.tieOuts[i] as (typeof t))!.reportColumn = e.target.value))} aria-label="Report column to compare with">
              <option value="">Report column…</option>
              {reportNames.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
            <label className="flex items-center gap-2 text-sm">
              <span className="shrink-0">Allow ±</span>
              <Input type="number" min={0} step="0.01" value={t.tolerance} onChange={(e) => update((r) => void ((r.checks.tieOuts[i] as (typeof t))!.tolerance = Math.max(0, Number(e.target.value) || 0)))} aria-label="Allowed difference" />
            </label>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" disabled={recipe.sources.length === 0} onClick={() => update((r) => void r.checks.tieOuts.push({ label: '', source: r.sources[0]?.id ?? '', column: '', reportColumn: '', tolerance: 1 }))}>
        <Plus className="size-4" /> Add a check
      </Button>
    </section>
  );
}

/** Tab 4: a plain sheet, or fill your own Excel template. */
export function OutputTab() {
  const recipe = useBuilder((s) => s.recipe);
  const update = useBuilder((s) => s.update);
  const [inspection, setInspection] = useState<InspectTemplateResult | null>(null);
  const [busy, setBusy] = useState(false);

  const output = recipe?.output;
  const reportColumns = useMemo(() => recipe?.report.columns.map((c) => c.name).filter((n) => n.trim() !== '') ?? [], [recipe?.report.columns]);
  const tpl = output?.mode === 'template' ? output : null;
  const key = tpl ? JSON.stringify([tpl.templateBase64.length, tpl.templateName, tpl.sheetName, tpl.headerRow, tpl.keepTemplateFormulas, reportColumns]) : '';

  useEffect(() => {
    if (!tpl || tpl.templateBase64 === '') {
      setInspection(null);
      return;
    }
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      inspectTemplateInWorker({ templateBase64: tpl.templateBase64, output: tpl, reportColumns })
        .then((r) => live && setInspection(r))
        .catch((err: unknown) => live && setInspection({ ok: false, sheets: [], message: err instanceof Error ? err.message : 'The template could not be read.' }))
        .finally(() => live && setBusy(false));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` already holds everything the call depends on
  }, [key]);

  if (!recipe || !output) return null;
  const patchTemplate = (fn: (o: TemplateOutput) => void) => update((r) => void (r.output.mode === 'template' && fn(r.output)));

  function setMode(mode: 'plain' | 'template') {
    if (mode === output?.mode) return;
    update((r) => {
      const { includeChecksSheet, includeCombinedSheet } = r.output;
      r.output =
        mode === 'plain'
          ? { mode: 'plain', sheetName: r.name.trim().slice(0, 31) || 'Report', includeChecksSheet, includeCombinedSheet }
          : { mode: 'template', templateName: '', templateBase64: '', headerRow: 'auto', keepTemplateFormulas: true, includeChecksSheet, includeCombinedSheet };
    });
  }

  async function addTemplate(files: File[]) {
    const file = files[0];
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      toast.error('Please choose an .xlsx file. Open the template in Excel and use Save As → Excel Workbook.');
      return;
    }
    const base64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    const problem = recipe ? await templateProblem(base64, recipe).catch(() => null) : null;
    if (problem) {
      toast.error(problem, { duration: 12000 });
      return;
    }
    if (file.size > TEMPLATE_WARN_BYTES) toast.warning(`This template is ${(file.size / 1024 / 1024).toFixed(1)} MB. Large templates make the recipe slow to save and share.`);
    patchTemplate((o) => {
      o.templateName = file.name;
      o.templateBase64 = base64;
      o.sheetName = undefined;
    });
  }

  const sizeKb = tpl ? Math.round((tpl.templateBase64.length * 3) / 4 / 1024) : 0;

  return (
    <div className="space-y-8">
      <section className="space-y-3" aria-labelledby="mode-h">
        <div>
          <h2 id="mode-h" className="text-lg font-medium">
            What should the finished report look like?
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-labelledby="mode-h">
          <ModeCard selected={output.mode === 'plain'} onSelect={() => setMode('plain')} icon={Table2} title="A plain Excel sheet" text="A new file with one clean table. Quickest to set up." />
          <ModeCard selected={output.mode === 'template'} onSelect={() => setMode('template')} icon={FileSpreadsheet} title="Fill my Excel template" text="Keeps your own layout, colours and formulas. The report goes into the table." />
        </div>
      </section>

      {output.mode === 'plain' && (
        <label className="block max-w-sm space-y-1 text-sm">
          <span className="font-medium">Name of the sheet</span>
          <Input value={output.sheetName} onChange={(e) => update((r) => void (r.output.mode === 'plain' && (r.output.sheetName = e.target.value)))} aria-invalid={output.sheetName.trim() === ''} />
        </label>
      )}

      {tpl && (
        <section className="space-y-4" aria-labelledby="tpl-h">
          <h2 id="tpl-h" className="text-lg font-medium">
            Your template
          </h2>
          {tpl.templateBase64 !== '' && (
            <p className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
              <FileSpreadsheet className="size-4 shrink-0" aria-hidden />
              <b className="break-all">{tpl.templateName || 'Template'}</b>
              <span className="text-muted-foreground">({sizeKb.toLocaleString('en-IN')} KB, saved inside this recipe)</span>
            </p>
          )}
          <FileDrop multiple={false} accept=".xlsx" compact title={tpl.templateBase64 === '' ? 'Upload the template' : 'Replace the template'} hint="An .xlsx file with the report headings in one row. The template is saved with the recipe." onFiles={(f) => void addTemplate(f)} />

          {tpl.templateBase64 !== '' && (
            <>
              {inspection && !inspection.ok && (
                <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  {inspection.message}
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Sheet</span>
                  <NativeSelect value={tpl.sheetName ?? ''} onChange={(e) => patchTemplate((o) => (o.sheetName = e.target.value || undefined))}>
                    <option value="">Find it automatically</option>
                    {(inspection?.sheets ?? []).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Heading row</span>
                  <div className="flex gap-2">
                    <NativeSelect className="w-36" value={tpl.headerRow === 'auto' ? 'auto' : 'row'} onChange={(e) => patchTemplate((o) => (o.headerRow = e.target.value === 'auto' ? 'auto' : inspection?.ok ? inspection.headerRow : 1))} aria-label="How the heading row is found">
                      <option value="auto">Find it</option>
                      <option value="row">Row number</option>
                    </NativeSelect>
                    {tpl.headerRow !== 'auto' && <Input type="number" min={1} className="w-24" value={tpl.headerRow} onChange={(e) => patchTemplate((o) => (o.headerRow = Math.max(1, Math.floor(Number(e.target.value) || 1))))} aria-label="Heading row number" />}
                  </div>
                  {inspection?.ok && <span className="block text-xs text-muted-foreground">Headings found on row {inspection.headerRow}; data goes from row {inspection.firstDataRow}.</span>}
                </label>
              </div>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-5 accent-primary" checked={tpl.keepTemplateFormulas} onChange={(e) => patchTemplate((o) => (o.keepTemplateFormulas = e.target.checked))} />
                <span>
                  <b>Keep the formulas in my template</b>
                  <span className="block text-xs text-muted-foreground">Columns where the template already has a formula (like Total Revenue) are left alone, and checked against the recipe&apos;s own formula.</span>
                </span>
              </label>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Where each report column goes {busy && <span className="font-normal text-muted-foreground">· checking…</span>}</h3>
                {reportColumns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Add report columns in 3 Report first.</p>
                ) : inspection?.ok ? (
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Report column</TableHead>
                          <TableHead>Template heading</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {inspection.mapping.map((m) => (
                          <TableRow key={m.reportColumn}>
                            <TableCell className="font-medium">{m.reportColumn}</TableCell>
                            <TableCell>{m.templateHeader ?? <span className="text-muted-foreground">—</span>}</TableCell>
                            <TableCell>
                              <Badge variant={STATUS[m.status].variant}>{STATUS[m.status].label}</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : null}
                {inspection?.ok && inspection.mapping.some((m) => m.status === 'unmatched') && (
                  <p className="text-xs text-muted-foreground">Headings are matched by name, ignoring capitals and spaces. Rename the report column or the template heading so they agree.</p>
                )}
              </div>
            </>
          )}
        </section>
      )}

      <section className="space-y-2" aria-labelledby="extra-h">
        <h2 id="extra-h" className="text-lg font-medium">
          Extra sheets in the file
        </h2>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-5 accent-primary" checked={output.includeChecksSheet} onChange={(e) => update((r) => void (r.output.includeChecksSheet = e.target.checked))} />
          <span>
            <b>Checks</b>
            <span className="block text-xs text-muted-foreground">Everything that was left out, not found or looks odd, with the file and row.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-5 accent-primary" checked={output.includeCombinedSheet} onChange={(e) => update((r) => void (r.output.includeCombinedSheet = e.target.checked))} />
          <span>
            <b>Combined data</b>
            <span className="block text-xs text-muted-foreground">Every row behind the numbers, so any figure can be traced. Makes the file bigger.</span>
          </span>
        </label>
      </section>

      <SafetyChecks />
    </div>
  );
}
