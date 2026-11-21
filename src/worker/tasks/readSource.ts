// Read one source file through its mapping: bytes -> fingerprint -> workbook ->
// sheet rows -> typed mapped rows. Shared by the name scan and the month run.
// Runs in the worker and in unit tests alike.

import { headersAt } from '@/excel/detectHeader';
import { sha256Hex } from '@/excel/fingerprint';
import { readMappedRows, resolveMapping, type MappedSheet, type MappingProblem } from '@/excel/mapSource';
import { listSheets, openWorkbook, readSheetRows, type SheetReadStats } from '@/excel/readWorkbook';
import type { FieldKey, SourceId, SourceMapping } from '@/core/types';
import type { TaskProgress } from '../protocol';

export type SourceInput = {
  sourceId: SourceId;
  file: File;
  mapping: SourceMapping;
  /** Fields the rules need; one that is not mapped makes the source Flagged. */
  required: FieldKey[];
};

type ReadBase = { sourceId: SourceId; fileName: string; sizeBytes: number; sha256: string };

export type ReadSourceResult =
  | (ReadBase & { ok: true; mapped: MappedSheet; stats: SheetReadStats })
  | (ReadBase & {
      ok: false;
      /** Why the file does not fit its mapping (a Flagged source). */
      problems: MappingProblem[];
    });

type Progress = (p: TaskProgress) => void;

/**
 * Never guesses: a file that does not fit its mapping comes back as `ok: false`
 * with the exact problems instead of being read with a changed mapping.
 * `range` scales this file's progress into the overall 0..1 range of the caller.
 */
export async function readSourceFile(
  input: SourceInput,
  onProgress: Progress = () => {},
  range: { from: number; to: number } = { from: 0, to: 1 },
): Promise<ReadSourceResult> {
  const { file, mapping, sourceId } = input;
  const at = (f: number) => range.from + (range.to - range.from) * f;
  const report = (stage: string, f: number, detail?: string) =>
    onProgress({ stage: `${stage}: ${file.name}`, fraction: at(f), detail });

  report('Reading', 0);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = await sha256Hex(bytes);
  const base: ReadBase = { sourceId, fileName: file.name, sizeBytes: file.size, sha256 };

  report('Opening', 0.1);
  const wb = openWorkbook(bytes);
  const sheets = listSheets(wb).map((s) => s.name);
  if (!sheets.includes(mapping.sheet)) {
    return {
      ...base,
      ok: false,
      problems: [
        {
          field: 'ref',
          message: `The sheet “${mapping.sheet}” was not found in this file (it has ${sheets.map((s) => `“${s}”`).join(', ')}).`,
          missingColumns: [],
        },
      ],
    };
  }

  const data = readSheetRows(wb, mapping.sheet, {
    progressEvery: 2000,
    onProgress: (done, total) =>
      report(
        'Reading rows',
        0.1 + 0.7 * (total === 0 ? 1 : done / total),
        `${done.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} rows`,
      ),
  });
  const resolved = resolveMapping(mapping, headersAt(data.rows, mapping.headerRow), new Set(input.required));
  if (resolved.problems.length > 0) return { ...base, ok: false, problems: resolved.problems };

  report('Mapping rows', 0.85);
  const mapped = readMappedRows(resolved, data.rows);
  report('Done', 1);
  return { ...base, ok: true, mapped, stats: data.stats };
}
