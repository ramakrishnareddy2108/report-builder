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
