import { FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FileDrop } from '@/components/FileDrop';
import { ProgressBar } from '@/components/ProgressBar';
import { assignFiles } from '@/engine/assignFiles';
import type { SourceDef } from '@/recipe/schema';
import { useBuilder } from './builderStore';
import { CombinedPreview } from './CombinedPreview';
import { loadSample, type Sample } from './sample';
import { SourceCard } from './SourceCard';
import { createSourceFromSample } from './sourceFactory';

/** Tab 1: sample files in, sources and their columns out. */
export function SourcesTab() {
  const recipe = useBuilder((s) => s.recipe);
  const update = useBuilder((s) => s.update);
  const setSample = useBuilder((s) => s.setSample);
  const [busy, setBusy] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  if (!recipe) return null;

  async function addFiles(files: File[]) {
    if (!recipe) return;
    const loaded: { file: File; sample: Sample; sheets: Sample['sheets'] }[] = [];
    for (const [i, file] of files.entries()) {
      setBusy(`Reading ${file.name} (${i + 1} of ${files.length})`);
      try {
        const { sample } = await loadSample(file);
        loaded.push({ file, sample, sheets: sample.sheets });
      } catch (err) {
        toast.error(`${file.name}: ${err instanceof Error ? err.message : 'could not be read.'}`);
      }
    }
    setBusy(null);
    if (loaded.length === 0) return;

    // Files that fit a source already in the recipe become its sample; the rest become new sources.
    const result = assignFiles(loaded.map((l) => ({ name: l.file.name, sheets: l.sheets })), recipe);
    const assigned = new Set<string>();
    let attached = 0;
    for (const a of result.assignments) {
      const item = loaded.find((l) => l.file.name === a.fileName);
      const source = recipe.sources.find((s) => s.id === a.sourceId);
      if (!item || !source) continue;
      assigned.add(a.fileName);
      const wantsOther = (source.sheet.name && source.sheet.name !== item.sample.sheet) || (typeof source.headerRow === 'number' && source.headerRow !== item.sample.headerRow);
      try {
        setSample(source.id, wantsOther ? (await loadSample(item.file, { sheet: source.sheet.name, headerRow: source.headerRow })).sample : item.sample);
        attached++;
      } catch {
        setSample(source.id, item.sample);
      }
    }

    const created: SourceDef[] = [];
    const taken = recipe.sources.map((s) => s.id);
    for (const item of loaded.filter((l) => !assigned.has(l.file.name))) {
      const source = createSourceFromSample(item.file.name, item.sample, [...taken, ...created.map((c) => c.id)]);
      created.push(source);
      setSample(source.id, item.sample);
    }
    if (created.length > 0) {
      update((r) => void r.sources.push(...created));
      setFresh((f) => [...f, ...created.map((c) => c.id)]);
    }
    const parts = [created.length > 0 && `${created.length} new source${created.length === 1 ? '' : 's'}`, attached > 0 && `${attached} sample file${attached === 1 ? '' : 's'} attached`].filter(Boolean);
    toast.success(parts.join(', ') + '. Now pick the columns you need.');
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Sample files</h2>
        <p className="text-sm text-muted-foreground">
          Add one Excel file for each report you get (for example last month&apos;s exports). Each file becomes a <b>source</b>. The files are only used here, to look at columns. They are never saved.
        </p>
        <FileDrop onFiles={(f) => void addFiles(f)} title="Add sample files" disabled={busy !== null} />
        {busy && <ProgressBar fraction={0.5} label={busy} />}
      </section>

      {recipe.sources.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <FileSpreadsheet className="size-4 shrink-0" aria-hidden /> No sources yet. Add a sample file above to start.
        </p>
      ) : (
        <section className="space-y-3" aria-label="Sources">
          {recipe.sources.map((s) => (
            <SourceCard key={s.id} sourceId={s.id} startOpen={fresh.includes(s.id) || recipe.sources.length === 1} />
          ))}
        </section>
      )}

      <CombinedPreview />
    </div>
  );
}
