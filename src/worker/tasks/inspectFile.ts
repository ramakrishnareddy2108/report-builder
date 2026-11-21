// inspectFile task: bytes → workbook → sheets with header guesses → rows of one sheet.
//
// Used by the recipe builder to preview a sample file. Pure apart from File.arrayBuffer(),
// so it runs in the worker and in unit tests alike.

import { detectHeader, headersAt, HEADER_SCAN_ROWS, type HeaderDetection } from '@/excel/detectHeader';
import { listSheets, openWorkbook, readSheetRows, type SheetRows } from '@/excel/readWorkbook';
import type { TaskProgress } from '../protocol';

export type InspectFileRequest = {
  file: File;
  /** Read this sheet instead of the first one that holds data. */
  sheet?: string;
  /** Use this 1-based header row instead of detecting it. */
  headerRow?: number;
  /** Skip reading data rows (sheet list and header only). */
  headersOnly?: boolean;
  /** Read only the first N Excel rows of the sheet (for previews). */
  maxRows?: number;
};

export type SheetSummary = {
  name: string;
  rowCount: number;
  columnCount: number;
  header: HeaderDetection | null;
};

export type InspectFileResult = {
  fileName: string;
  sizeBytes: number;
  sheets: SheetSummary[];
  /** The sheet that was read (null when the workbook has no usable sheet). */
  sheet: string | null;
  header: HeaderDetection | null;
  data: SheetRows | null;
};

type Progress = (p: TaskProgress) => void;

export async function inspectFileTask(req: InspectFileRequest, onProgress: Progress = () => {}): Promise<InspectFileResult> {
  const { file } = req;
  onProgress({ stage: 'Reading file', fraction: 0 });
  const wb = openWorkbook(new Uint8Array(await file.arrayBuffer()));

  onProgress({ stage: 'Finding headers', fraction: 0.4 });
  const sheets: SheetSummary[] = listSheets(wb).map((info) => ({
    ...info,
    header: detectHeader(readSheetRows(wb, info.name, { maxRows: HEADER_SCAN_ROWS }).rows),
  }));

  const sheet = req.sheet ?? sheets.find((s) => s.rowCount > 0)?.name ?? sheets[0]?.name ?? null;
  let data: SheetRows | null = null;
  let header: HeaderDetection | null = null;

  if (sheet !== null) {
    if (req.headersOnly) {
      const head = readSheetRows(wb, sheet, { maxRows: HEADER_SCAN_ROWS }).rows;
      header = req.headerRow !== undefined ? headersAt(head, req.headerRow) : (sheets.find((s) => s.name === sheet)?.header ?? null);
    } else {
      onProgress({ stage: 'Reading rows', fraction: 0.5 });
      data = readSheetRows(wb, sheet, {
        maxRows: req.maxRows,
        progressEvery: 2000,
        onProgress: (done, total) =>
          onProgress({
            stage: 'Reading rows',
            fraction: 0.5 + 0.5 * (total === 0 ? 1 : done / total),
            detail: `${done.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} rows`,
          }),
      });
      header = req.headerRow !== undefined ? headersAt(data.rows, req.headerRow) : detectHeader(data.rows);
    }
  }

  onProgress({ stage: 'Done', fraction: 1 });
  return { fileName: file.name, sizeBytes: file.size, sheets, sheet, header, data };
}
