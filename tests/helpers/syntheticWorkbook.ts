// Builds small made-up workbooks in memory, shaped like the HIS exports:
// two title rows, header on row 3, data from row 4. No real patient data.

import * as XLSX from 'xlsx';

export const CONSULT_HEADERS = [
  'CONSULTATIONNO',
  'CONSULTATIONDT',
  'UMRNO',
  'DOCTORNAME',
  'DEPARTMENTNAME',
  'CONSULTATIONAMT', // J in the real file; here column F
  'DISCOUNT',
  'Net Amount',
  'ORGANIZATIONNAME',
  '', // blank header → "Column J"
  'DOCTORNAME', // duplicate → "DOCTORNAME (2)"
];

/** OP Consultations-like sheet. Net Amount (col H) is a formula `F-G` with a cached value. */
export function consultationsSheet(opts: { withoutCachedValue?: boolean } = {}): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(
    [
      ['G2 Health Care'],
      ['OP Consultations Report From 01-Oct-2026 To 31-Oct-2026'],
      CONSULT_HEADERS,
      ['C001', new Date(Date.UTC(2026, 9, 2)), 'UMR1', 'Dr. A Kumar', 'CARDIOLOGY', 500, 50, null, 'GENERAL', null, 'x'],
      ['C002', new Date(Date.UTC(2026, 9, 3)), 'UMR2', ' dr b rao', 'cardiology', 300, 0, null, 'STAR HEALTH', null, 'y'],
      [null, null, null, null, null, 800, 50, null, null, null, null], // grand-total footer
    ],
    { cellDates: true },
  );
  ws['H4'] = opts.withoutCachedValue ? { t: 'n', f: 'F4-G4' } : { t: 'n', f: 'F4-G4', v: 450 };
  ws['H5'] = { t: 'n', f: 'F5-G5', v: 300 };
  ws['H6'] = { t: 'n', f: 'F6-G6', v: 750 };
  return ws;
}

/** A sheet whose used range starts at C5 (nothing in rows 1–4 or columns A–B). */
export function offsetSheet(): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  XLSX.utils.sheet_add_aoa(ws, [['BILLNO', 'AMOUNT'], ['B1', 10]], { origin: 'C5' });
  return ws;
}

export function buildWorkbook(sheets: Record<string, XLSX.WorkSheet>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, ws] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, ws, name);
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(out);
}

export function consultationsWorkbook(opts: { withoutCachedValue?: boolean } = {}): Uint8Array {
  return buildWorkbook({
    Sheet1: consultationsSheet(opts),
    Sheet2: XLSX.utils.aoa_to_sheet([]),
    Offset: offsetSheet(),
  });
}

/** A HIS-style sheet: two title rows, header on row 3, data from row 4. */
export function hisSheet(header: readonly string[], rows: readonly (readonly unknown[])[]): XLSX.WorkSheet {
  const aoa = [['G2 Health Care'], ['Report 01-Oct-2026 To 31-Oct-2026'], [...header], ...rows.map((r) => [...r])] as unknown[][];
  return XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
}

/** A File holding a HIS-style workbook. */
export function hisFile(name: string, header: string[], rows: (string | number | Date | null)[][], sheet = 'Sheet1'): File {
  const bytes = buildWorkbook({ [sheet]: hisSheet(header, rows) });
  return new File([bytes as Uint8Array<ArrayBuffer>], name);
}

/** A workbook with one HIS-shaped sheet (plus any extra sheets by name). */
export function hisWorkbook(
  sheetName: string,
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
  extra: Record<string, XLSX.WorkSheet> = {},
): Uint8Array {
  return buildWorkbook({ [sheetName]: hisSheet(headers, rows), ...extra });
}

/** Wrap bytes as a File (for worker tasks that take uploads). */
export function asFile(bytes: Uint8Array, name: string): File {
  return new File([bytes as Uint8Array<ArrayBuffer>], name);
}
