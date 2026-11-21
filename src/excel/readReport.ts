// Read a filled report workbook (a DRR or Sponsor-wise made earlier) back into rows.
// Used to import past months as summaries, and to compare with the tool's own numbers.

import type ExcelJS from 'exceljs';
import { measuresFor, type MeasureDef, type ReportKind } from '@/core/measures';
import { toPaise } from '@/core/money';
import type { MeasureCode } from '@/core/types';
import { TemplateError, loadTemplate } from './templates';

export type ReadReportRow = {
  /** Doctor or sponsor name as written in the file. */
  name: string;
  /** DRR only; '' otherwise. */
  department: string;
  /** Integer paise for money columns, plain numbers for counts. Blank cells are left out. */
  values: Partial<Record<MeasureCode, number>>;
};

/** A cell as paise (money) or as a plain count; null when blank or unreadable. */
function numberOf(cell: ExcelJS.Cell, kind: MeasureDef['kind']): number | null {
  const v = cell.value;
  const raw = v !== null && typeof v === 'object' && 'result' in v ? v.result : v;
  if (kind === 'count') return typeof raw === 'number' ? raw : null;
  return typeof raw === 'number' || typeof raw === 'string' ? toPaise(raw) : null;
}

function textOf(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (typeof v === 'string') return v.trim();
  if (v !== null && typeof v === 'object' && 'richText' in v) return v.richText.map((t) => t.text).join('').trim();
  return '';
}

/**
 * The data rows of a filled report, found by header names. Returns null when the table holds no
 * data rows (an empty template). Throws TemplateError when the file has no such table.
 */
export async function readReportRows(bytes: ArrayBuffer | Uint8Array, kind: ReportKind): Promise<ReadReportRow[] | null> {
  const table = await loadTemplate(bytes, kind);
  const nameHeader = kind === 'drr' ? 'Doctor Name' : 'Sponsor Name';
  const nameCol = table.columns.get(nameHeader);
  if (nameCol === undefined) {
    throw new TemplateError(`This does not look like a ${kind === 'drr' ? 'DRR' : 'Sponsor-wise'} report: no “${nameHeader}” column was found.`);
  }
  const deptCol = table.columns.get('Department');
  const rows: ReadReportRow[] = [];
  for (let r = table.firstDataRow; r <= table.sheet.rowCount; r++) {
    const line = table.sheet.getRow(r);
    const name = textOf(line.getCell(nameCol));
    if (name === '') continue;
    const values: ReadReportRow['values'] = {};
    for (const m of measuresFor(kind)) {
      const col = table.columns.get(kind === 'drr' ? m.drrHeader : (m.sponsorHeader as string));
      const value = col === undefined ? null : numberOf(line.getCell(col), m.kind);
      if (value !== null) values[m.code] = value;
    }
    rows.push({ name, department: kind === 'drr' && deptCol !== undefined ? textOf(line.getCell(deptCol)) : '', values });
  }
  return rows.length > 0 ? rows : null;
}
