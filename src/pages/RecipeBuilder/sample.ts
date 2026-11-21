// A sample file in the recipe builder: kept in memory only (never saved), so the user can pick columns and
// check formulas against real headers. The recipe itself only stores the choices.

import type { Row } from '@/excel/readWorkbook';
import { inspectFileInWorker } from '@/worker/client';
import type { InspectFileResult, SheetSummary } from '@/worker/tasks/inspectFile';

export const PREVIEW_ROWS = 50;

export type Sample = {
  file: File;
  sheets: SheetSummary[];
  sheet: string | null;
  /** 1-based Excel row of the header (detected, or the one the recipe says). */
  headerRow: number | null;
  /** Unique column names, index 0 = column A. */
  headers: string[];
  /** The header text as it is in the file ('' for a blank header). */
  rawHeaders: string[];
  /** The first rows below the header. */
  rows: Row[];
  /** Used rows in the sheet (header and title rows included). */
  sheetRowCount: number;
};

export function sampleFromInspect(file: File, r: InspectFileResult): Sample {
  const headerRow = r.header?.headerRow ?? null;
  const all = r.data?.rows ?? [];
  return {
    file,
    sheets: r.sheets,
    sheet: r.sheet,
    headerRow,
    headers: r.header?.headers ?? [],
    rawHeaders: r.header?.rawHeaders ?? [],
    rows: headerRow === null ? [] : all.slice(headerRow, headerRow + PREVIEW_ROWS),
    sheetRowCount: r.sheets.find((s) => s.name === r.sheet)?.rowCount ?? 0,
  };
}

/** Read a file (in the worker) for previewing. `headerRow` and `sheet` override what is detected. */
export async function loadSample(file: File, opts: { sheet?: string; headerRow?: number | 'auto' } = {}): Promise<{ sample: Sample; inspected: InspectFileResult }> {
  const headerRow = typeof opts.headerRow === 'number' ? opts.headerRow : undefined;
  const inspected = await inspectFileInWorker({
    file,
    sheet: opts.sheet,
    headerRow,
    maxRows: Math.max(20 + PREVIEW_ROWS, (headerRow ?? 0) + PREVIEW_ROWS),
  });
  return { sample: sampleFromInspect(file, inspected), inspected };
}
