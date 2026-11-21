// Loading HIS Excel files into the session: read in the worker (with progress),
// identify the source, and line the sheet and header row up with the source's
// mapping. Files are read one at a time to keep memory low.

import { defaultMappingFor } from '@/core/sourceDefaults';
import type { SourceId, SourceMapping } from '@/core/types';
import { DEFAULT_SOURCE_SIGNATURES, signatureFromMapping, type SourceSignature } from '@/excel/identifySource';
import { readFileInWorker } from '@/worker/client';
import type { ReadFileResult } from '@/worker/tasks/readFile';
import { useFiles, type LoadedFile } from './filesStore';
import { useSettings } from './settingsStore';

/** Excel rows kept for previews (title rows included). */
export const PREVIEW_ROWS = 300;
/** Below this confidence the user is asked to choose the source. */
export const CONFIRM_BELOW = 0.6;

/** The saved mapping for a source, or the built-in default that pre-fills the editor. */
export function mappingFor(sourceId: SourceId): SourceMapping {
  return useSettings.getState().sources.sources.find((m) => m.sourceId === sourceId) ?? defaultMappingFor(sourceId);
}

/** Saved mappings take over from the built-in signatures. */
function signatures(): SourceSignature[] {
  const saved = useSettings.getState().sources.sources;
  return DEFAULT_SOURCE_SIGNATURES.map((sig) => {
    const m = saved.find((s) => s.sourceId === sig.sourceId);
    return m ? signatureFromMapping(m) : { ...sig };
  });
}

function toPatch(res: ReadFileResult, sourceId: SourceId | null): Partial<LoadedFile> {
  return {
    state: 'ready',
    progress: null,
    error: null,
    sha256: res.sha256,
    identification: res.identification,
    sourceId,
    sheets: res.sheets,
    sheet: res.sheet,
    header: res.header,
    previewRows: res.data?.rows ?? [],
    formulaCellsWithoutValue: res.data?.stats.formulaCellsWithoutValue ?? 0,
  };
}

const patch = (id: string, p: Partial<LoadedFile>) => useFiles.getState().patch(id, p);

function read(id: string, file: File, opts: { sheet?: string; headerRow?: number } = {}): Promise<ReadFileResult> {
  return readFileInWorker({ file, ...opts, signatures: signatures(), maxRows: PREVIEW_ROWS }, (progress) =>
    patch(id, { progress }),
  );
}

/** Re-read with the mapping's sheet and header row when the first read picked others. */
async function alignToMapping(id: string, file: File, res: ReadFileResult, sourceId: SourceId | null): Promise<ReadFileResult> {
  if (!sourceId) return res;
  const m = mappingFor(sourceId);
  if (!res.sheets.some((s) => s.name === m.sheet)) return res; // reported as Flagged
  if (res.sheet === m.sheet && res.header?.headerRow === m.headerRow) return res;
  return read(id, file, { sheet: m.sheet, headerRow: m.headerRow });
}

function fail(id: string, err: unknown): void {
  patch(id, { state: 'error', progress: null, error: err instanceof Error ? err.message : String(err) });
}

let queue: Promise<void> = Promise.resolve();

/** Add files to the session and read them, one after another. */
export function loadFiles(files: readonly File[]): void {
  for (const file of files) {
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) continue;
    const id = useFiles.getState().add(file);
    queue = queue.then(async () => {
      try {
        const first = await read(id, file);
        const { sourceId, confidence } = first.identification;
        const confident = sourceId !== null && confidence >= CONFIRM_BELOW ? sourceId : null;
        patch(id, toPatch(await alignToMapping(id, file, first, confident), confident));
      } catch (err) {
        fail(id, err);
      }
    });
  }
}

/** Read a loaded file again with another sheet or header row (keeps its source). */
export async function rereadFile(id: string, opts: { sheet?: string; headerRow?: number }): Promise<void> {
  const current = useFiles.getState().files.find((f) => f.id === id);
  if (!current) return;
  patch(id, { state: 'reading', progress: null });
  try {
    patch(id, toPatch(await read(id, current.file, opts), current.sourceId));
  } catch (err) {
    fail(id, err);
  }
}

/** The user chose (or cleared) the source for a file. */
export async function assignSource(id: string, sourceId: SourceId | null): Promise<void> {
  const current = useFiles.getState().files.find((f) => f.id === id);
  if (!current) return;
  patch(id, { sourceId });
  if (!sourceId || current.state !== 'ready') return;
  const m = mappingFor(sourceId);
  const hasSheet = current.sheets.some((s) => s.name === m.sheet);
  if (hasSheet && (current.sheet !== m.sheet || current.header?.headerRow !== m.headerRow)) {
    await rereadFile(id, { sheet: m.sheet, headerRow: m.headerRow });
  }
}
