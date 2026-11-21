// Small made-up report templates shaped like the real ones: title rows, a
// SUBTOTAL row, headers on row 4, and pre-numbered rows with the Total Revenue
// and Gross Profit formulas. No real data.

import ExcelJS from 'exceljs';
import { DRR_HEADERS, SPONSOR_HEADERS } from '@/core/measures';

const ACCOUNTING = '_ * #,##0_ ;_ * -#,##0_ ;_ * "-"??_ ;_ @_ ';

type Options = {
  /** Pre-made rows below the header (default 6: rows 5-10). */
  preMade?: number;
  /** Where the SUBTOTAL range ends (default 960, as in the real templates). */
  subtotalEnd?: number;
  /** Headers to leave out. */
  omit?: string[];
  /** Replace a formula (by header) in every pre-made row, e.g. to simulate an edited template. */
  formula?: Record<string, (row: number) => string>;
  /** Shuffle the header texts: extra spaces and other case. */
  messyHeaders?: boolean;
};

const col = (n: number) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

async function build(kind: 'drr' | 'sponsor', opts: Options): Promise<Uint8Array> {
  const headers = (kind === 'drr' ? DRR_HEADERS : SPONSOR_HEADERS).filter((h) => !opts.omit?.includes(h));
  const at = (h: string) => headers.indexOf(h) + 1;
  const preMade = opts.preMade ?? 6;
  const first = 5;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = 'G2 Health Care';

  // Row 2: totals over the data rows (from the 5th column on, like the real templates).
  const firstMeasure = kind === 'drr' ? 5 : 4;
  for (let c = firstMeasure; c <= headers.length; c++) {
    const cell = ws.getRow(2).getCell(c);
    cell.value = { formula: `SUBTOTAL(9,${col(c)}${first}:${col(c)}${opts.subtotalEnd ?? 960})`, result: 0 };
    cell.font = { bold: true };
    cell.numFmt = ACCOUNTING;
  }

  headers.forEach((h, i) => {
    const cell = ws.getRow(4).getCell(i + 1);
    cell.value = opts.messyHeaders ? `  ${h.toUpperCase().split(' ').join('  ')} ` : h;
    cell.font = { bold: true };
  });
  ws.getRow(4).height = 34.5;

  const letter = (h: string) => col(at(h));
  const formulas: Record<string, (r: number) => string> =
    kind === 'drr'
      ? {
          'Total Revenue': (r) => `+${letter('IP Revenue')}${r}+${letter('OP Revenue')}${r}+${letter('OP Pharmacy')}${r}`,
          'Gross Profit': (r) =>
            `+${letter('Total Revenue')}${r}-${letter('OP Pharmacy Cost')}${r}-${letter('Ip Pharmacy Cost')}${r}-${letter('Departmental Issues Cost')}${r}-${letter('Salary Cost')}${r}-${letter('Incentives')}${r}-${letter('Professional Fee')}${r}`,
        }
      : {
          'Total Revenue': (r) => `+${letter('IP Revenue')}${r}+${letter('OP Revenue')}${r}+${letter('OP Pharmacy')}${r}`,
          'Gross Profit': (r) => `+${letter('Total Revenue')}${r}-${letter('OP Pharmacy Cost')}${r}-${letter('Ip Pharmacy Cost')}${r}`,
        };

  for (let i = 0; i < preMade; i++) {
    const r = first + i;
    const row = ws.getRow(r);
    headers.forEach((h, c) => {
      const cell = row.getCell(c + 1);
      if (h === 'S.No.') cell.value = i === preMade - 1 ? 504 : i + 1; // numbering need not be sequential
      else if (h === 'Month') {
        cell.numFmt = 'mmm-yy';
      } else if (formulas[h] && h in formulas) {
        const make = opts.formula?.[h] ?? formulas[h];
        cell.value = { formula: make(r), result: 0 };
        cell.numFmt = ACCOUNTING;
      } else if (h !== 'Doctor Name' && h !== 'Department' && h !== 'Sponsor Name') {
        cell.numFmt = ACCOUNTING;
      }
      // The last pre-made row has a marker colour so a test can see styles being copied down.
      if (i === preMade - 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF99' } };
    });
  }
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

export const drrTemplate = (opts: Options = {}) => build('drr', opts);
export const sponsorTemplate = (opts: Options = {}) => build('sponsor', opts);

export async function reopen(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb;
}
