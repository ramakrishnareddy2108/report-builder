// readFile task: bytes → fingerprint → workbook → headers per sheet →
// source identification → rows of the chosen sheet.
//
// Pure apart from File.arrayBuffer() and crypto.subtle, so it runs in the
// worker and in unit tests alike.

import { detectHeader, headersAt, HEADER_SCAN_ROWS, type HeaderDetection } from '@/excel/detectHeader';
import { sha256Hex } from '@/excel/fingerprint';
import {
  DEFAULT_SOURCE_SIGNATURES,
  identifySource,
  type SourceIdentification,
  type SourceSignature,
} from '@/excel/identifySource';
import { listSheets, openWorkbook, readSheetRows, type SheetRows } from '@/excel/readWorkbook';
import type { TaskProgress } from '../protocol';

export type ReadFileRequest = {
  file: File;
  /** Read this sheet instead of the one the identification picks. */
  sheet?: string;
  /** Use this 1-based header row instead of detecting it. */
  headerRow?: number;
  /** Known sources (from settings/sources.json); defaults to the built-in ones. */
  signatures?: SourceSignature[];
  /** Skip reading data rows (identification and header only). */
  headersOnly?: boolean;
};

export type SheetSummary = {
  name: string;
  rowCount: number;
  columnCount: number;
  header: HeaderDetection | null;
};

export type ReadFileResult = {
  fileName: string;
  sizeBytes: number;
  lastModified: number;
  sha256: string;
  sheets: SheetSummary[];
  identification: SourceIdentification;
  /** The sheet that was read (null when the workbook has no usable sheet). */
  sheet: string | null;
  header: HeaderDetection | null;
  data: SheetRows | null;
  readMs: number;
};

type Progress = (p: TaskProgress) => void;

export async function readFileTask(req: ReadFileRequest, onProgress: Progress = () => {}): Promise<ReadFileResult> {
  const started = Date.now();
  const { file } = req;

  onProgress({ stage: 'Reading file', fraction: 0 });
  const bytes = new Uint8Array(await file.arrayBuffer());

  onProgress({ stage: 'Fingerprinting', fraction: 0.1 });
  const sha256 = await sha256Hex(bytes);

  onProgress({ stage: 'Opening workbook', fraction: 0.15 });
  const wb = openWorkbook(bytes);

  onProgress({ stage: 'Finding headers', fraction: 0.6 });
  const sheets: SheetSummary[] = listSheets(wb).map((info) => {
    const preview = readSheetRows(wb, info.name, { maxRows: HEADER_SCAN_ROWS });
    return { ...info, header: detectHeader(preview.rows) };
  });

  const identification = identifySource(
    file.name,
    sheets.map((s) => ({ sheet: s.name, headerRow: s.header?.headerRow ?? null, headers: s.header?.rawHeaders ?? [] })),
    req.signatures ?? DEFAULT_SOURCE_SIGNATURES,
  );

  const sheet =
    req.sheet ?? identification.sheet ?? sheets.find((s) => s.rowCount > 0)?.name ?? sheets[0]?.name ?? null;

  let data: SheetRows | null = null;
  let header: HeaderDetection | null = null;
  if (sheet !== null) {
    const summary = sheets.find((s) => s.name === sheet);
    if (req.headersOnly) {
      header = req.headerRow !== undefined
        ? headersAt(readSheetRows(wb, sheet, { maxRows: HEADER_SCAN_ROWS }).rows, req.headerRow)
        : (summary?.header ?? null);
    } else {
      onProgress({ stage: 'Reading rows', fraction: 0.65 });
      data = readSheetRows(wb, sheet, {
        progressEvery: 2000,
        onProgress: (done, total) =>
          onProgress({
            stage: 'Reading rows',
            fraction: 0.65 + 0.35 * (total === 0 ? 1 : done / total),
            detail: `${done.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} rows`,
          }),
      });
      header = req.headerRow !== undefined ? headersAt(data.rows, req.headerRow) : detectHeader(data.rows);
    }
  }

  onProgress({ stage: 'Done', fraction: 1 });
  return {
    fileName: file.name,
    sizeBytes: file.size,
    lastModified: file.lastModified,
    sha256,
    sheets,
    identification,
    sheet,
    header,
    data,
    readMs: Date.now() - started,
  };
}
