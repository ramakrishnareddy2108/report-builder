import { ArrowLeft, Loader2, Save } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { rereadFile, mappingFor } from '@/app/fileLoader';
import { useSettings } from '@/app/settingsStore';
import type { SourceInfo } from '@/app/useSourceInfos';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SCHEMA_VERSION } from '@/core/schemas';
import { FIELD_KEYS, FIELD_LABELS, SOURCE_IDS, SOURCE_LABELS, type FieldKey, type FieldMapping, type SourceMapping } from '@/core/types';
import { readMappedRows, resolveMapping } from '@/excel/mapSource';
import { FieldRow } from './FieldRow';
import { FormulaInput } from './FormulaInput';
import { MappingPreview, PREVIEW_DATA_ROWS } from './MappingPreview';
import { StatusBadge } from './SourcesTable';

type Props = { info: SourceInfo; onClose: () => void };

export function MappingEditor({ info, onClose }: Props) {
  const { sourceId, file, required } = info;
  const saveSources = useSettings((s) => s.saveSources);
  const sources = useSettings((s) => s.sources);
  const [draft, setDraft] = useState<SourceMapping>(() => mappingFor(sourceId));
  const [extra, setExtra] = useState<FieldKey[]>([]);
  const [saving, setSaving] = useState(false);

  const header = file?.header ?? null;
  // The file is read at the draft's sheet and header row; while it catches up, wait.
  const inSync = file !== null && header !== null && file.sheet === draft.sheet && header.headerRow === draft.headerRow;

  const resolved = useMemo(() => (header && inSync ? resolveMapping(draft, header, required) : null), [draft, header, inSync, required]);
  const preview = useMemo(
    () => (resolved && file ? readMappedRows(resolved, file.previewRows, { maxRows: PREVIEW_DATA_ROWS }) : null),
    [resolved, file],
  );

  const shownFields = useMemo(() => {
    const keys = new Set<FieldKey>([...(Object.keys(draft.fields) as FieldKey[]), ...required, ...extra]);
    return FIELD_KEYS.filter((k) => keys.has(k));
  }, [draft.fields, required, extra]);
  const hiddenFields = FIELD_KEYS.filter((k) => !shownFields.includes(k));
  const mappedFields = shownFields.filter((k) => draft.fields[k] && draft.fields[k]?.type !== 'none');

  const update = (patch: Partial<SourceMapping>) => setDraft((d) => ({ ...d, ...patch }));
  const setField = (key: FieldKey, next: FieldMapping) =>
    setDraft((d) => ({ ...d, fields: { ...d.fields, [key]: next } }));

  function changeSheet(sheet: string) {
    const detected = file?.sheets.find((s) => s.name === sheet)?.header?.headerRow ?? draft.headerRow;
    update({ sheet, headerRow: detected });
    if (file) void rereadFile(file.id, { sheet, headerRow: detected });
  }

  function changeHeaderRow(text: string) {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1 || n > 50 || n === draft.headerRow) return;
    update({ headerRow: n });
    if (file) void rereadFile(file.id, { sheet: draft.sheet, headerRow: n });
  }

  const problems = resolved?.problems ?? [];
  const nameMissing = draft.namePattern.trim() === '';
  const canSave = inSync && problems.length === 0 && !nameMissing && !saving;

  async function save() {
    setSaving(true);
    try {
      const cleaned: SourceMapping = {
        ...draft,
        namePattern: draft.namePattern.trim(),
        rowFilter: draft.rowFilter?.trim() ? draft.rowFilter.trim() : null,
        fields: Object.fromEntries(Object.entries(draft.fields).filter(([, m]) => m && m.type !== 'none')),
      };
      const others = sources.sources.filter((m) => m.sourceId !== sourceId);
      const next = [...others, cleaned].sort((a, b) => SOURCE_IDS.indexOf(a.sourceId) - SOURCE_IDS.indexOf(b.sourceId));
      await saveSources({ version: SCHEMA_VERSION, sources: next });
      toast.success(`${SOURCE_LABELS[sourceId]} mapping saved.`);
      onClose();
    } catch (err) {
      toast.error(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft />
          Back to sources
        </Button>
        <h2 className="text-lg font-semibold">{SOURCE_LABELS[sourceId]}</h2>
        <StatusBadge status={info.status.status} />
      </div>

      {!file && (
        <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
          Load this source’s Excel file on the Sources page first (drop it in, then choose “{SOURCE_LABELS[sourceId]}”
          if it was not recognised). The column lists and the preview need a file to read.
        </div>
      )}

      {file && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>File layout</CardTitle>
              <CardDescription>{file.file.name}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-4">
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Sheet</span>
                <Select value={draft.sheet} onValueChange={changeSheet}>
                  <SelectTrigger aria-label="Sheet">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {file.sheets.map((s) => (
                      <SelectItem key={s.name} value={s.name}>
                        {s.name} ({s.rowCount.toLocaleString('en-IN')} rows)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Header row</span>
                <Input
                  key={`${draft.sheet}-${draft.headerRow}`}
                  type="number"
                  min={1}
                  max={50}
                  defaultValue={draft.headerRow}
                  onBlur={(e) => changeHeaderRow(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && changeHeaderRow(e.currentTarget.value)}
                />
              </label>
              <label className="space-y-1.5 text-sm md:col-span-2">
                <span className="font-medium">File name contains</span>
                <Input value={draft.namePattern} onChange={(e) => update({ namePattern: e.target.value })} aria-invalid={nameMissing} />
              </label>
              <label className="flex items-center gap-2 text-sm md:col-span-4">
                <input
                  type="checkbox"
                  checked={draft.refUnique}
                  onChange={(e) => update({ refUnique: e.target.checked })}
                  className="size-4"
                />
                Each bill / admission number appears once (duplicates are reported in Checks)
              </label>
            </CardContent>
          </Card>

          {!inSync && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Reading the sheet…
            </p>
          )}

          {inSync && header && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Fields</CardTitle>
                  <CardDescription>
                    Where each value comes from. Fields marked “needed” are used by the measure rules.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y border-t">
                    {shownFields.map((key) => (
                      <FieldRow
                        key={key}
                        field={key}
                        mapping={draft.fields[key]}
                        resolved={resolved?.fields[key]}
                        header={header}
                        problems={problems}
                        required={required.has(key)}
                        onChange={(m) => setField(key, m)}
                      />
                    ))}
                  </div>
                  {hiddenFields.length > 0 && (
                    <div className="border-t px-4 py-3">
                      <Select value="" onValueChange={(k) => setExtra((e) => [...e, k as FieldKey])}>
                        <SelectTrigger className="w-64" aria-label="Add a field">
                          <SelectValue placeholder="Add another field…" />
                        </SelectTrigger>
                        <SelectContent>
                          {hiddenFields.map((k) => (
                            <SelectItem key={k} value={k}>
                              {FIELD_LABELS[k].label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Row filter (optional)</CardTitle>
                  <CardDescription>
                    A formula over this file’s columns. Rows where it is false are left out and counted in Checks.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <FormulaInput
                    label="Row filter"
                    value={draft.rowFilter ?? ''}
                    onChange={(v) => update({ rowFilter: v })}
                    columns={header.headers}
                    missingColumns={problems.filter((p) => p.field === 'rowFilter').flatMap((p) => p.missingColumns)}
                    placeholder='For example [BILLSTATUS] <> "CANCELLED"'
                  />
                </CardContent>
              </Card>

              {problems.length > 0 && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm" role="alert">
                  <p className="font-medium text-destructive">Fix these before saving:</p>
                  <ul className="mt-1 list-disc pl-5 text-destructive">
                    {problems.map((p, i) => (
                      <li key={i}>{p.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {preview && (
                <Card>
                  <CardHeader>
                    <CardTitle>Preview</CardTitle>
                    <CardDescription>The first rows as the tool will read them. Money is shown in rupees.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <MappingPreview sheet={preview} fields={mappedFields} />
                  </CardContent>
                </Card>
              )}
            </>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={!canSave}>
              <Save />
              {saving ? 'Saving…' : 'Confirm and save'}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
