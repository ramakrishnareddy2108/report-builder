// The extra sheets of a report workbook: Checks (what was looked at) and Data
// (the fact rows behind the numbers, with no patient data).

import type ExcelJS from 'exceljs';
import { getMeasure } from '@/core/measures';
import { paiseToRupees } from '@/core/money';
import { UNATTRIBUTED_DOCTOR_ID, UNATTRIBUTED_DOCTOR_NAME, type CheckResult, type FactRow } from '@/core/types';
import { escapeCell } from './escape';

function uniqueSheetName(workbook: ExcelJS.Workbook, wanted: string): string {
  const taken = new Set(workbook.worksheets.map((s) => s.name.toLowerCase()));
  let name = wanted;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${wanted} (${n})`;
  return name;
}

function styleHeader(sheet: ExcelJS.Worksheet): void {
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle', wrapText: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

const MAX_DETAIL_LINES = 25;

/** A sheet listing every check: level, check, message, numbers, details and the user's note. */
export function addChecksSheet(workbook: ExcelJS.Workbook, checks: readonly CheckResult[]): void {
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook, 'Checks'));
  sheet.columns = [
    { header: 'Level', key: 'level', width: 10 },
    { header: 'Check', key: 'title', width: 38 },
    { header: 'Message', key: 'message', width: 70 },
    { header: 'Rows', key: 'rows', width: 8 },
    { header: 'Amount (₹)', key: 'amount', width: 16, style: { numFmt: '#,##0.00' } },
    { header: 'Details', key: 'details', width: 70 },
    { header: 'Note', key: 'note', width: 50 },
  ];
  for (const c of checks) {
    const details = c.details ?? [];
    sheet.addRow({
      level: c.level,
      title: escapeCell(c.title),
      message: escapeCell(c.message),
      rows: c.rows ?? null,
      amount: c.amountPaise === undefined ? null : paiseToRupees(c.amountPaise),
      details: escapeCell(details.slice(0, MAX_DETAIL_LINES).join('\n') + (details.length > MAX_DETAIL_LINES ? `\n… and ${details.length - MAX_DETAIL_LINES} more` : '')) || null,
      note: escapeCell(c.note ?? '') || null,
    });
  }
  styleHeader(sheet);
  sheet.eachRow((row, n) => {
    if (n > 1) row.alignment = { vertical: 'top', wrapText: true };
  });
}

/** A sheet with every fact row. Only bill numbers, UMRNO, dates, names of doctors/departments/sponsors, amounts and the source row are kept. */
export function addDataSheet(
  workbook: ExcelJS.Workbook,
  facts: readonly FactRow[],
  doctorNames: ReadonlyMap<string, string>,
): void {
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook, 'Data'));
  sheet.columns = [
    { header: 'Month', key: 'month', width: 10 },
    { header: 'Measure', key: 'measure', width: 22 },
    { header: 'Amount (₹)', key: 'amount', width: 16, style: { numFmt: '#,##0.00' } },
    { header: 'Count', key: 'count', width: 8 },
    { header: 'Doctor', key: 'doctor', width: 30 },
    { header: 'Department', key: 'department', width: 22 },
    { header: 'Sponsor', key: 'sponsor', width: 26 },
    { header: 'Source', key: 'source', width: 18 },
    { header: 'File', key: 'file', width: 38 },
    { header: 'Row', key: 'row', width: 8 },
    { header: 'Reference', key: 'ref', width: 16 },
    { header: 'UMRNO', key: 'umrno', width: 16 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Attribution', key: 'attribution', width: 14 },
    { header: 'Attribution method', key: 'method', width: 34 },
  ];
  for (const f of facts) {
    const isCount = getMeasure(f.measure).kind === 'count';
    const doctor =
      f.doctorId === null ? '(unmatched doctor)' : f.doctorId === UNATTRIBUTED_DOCTOR_ID ? UNATTRIBUTED_DOCTOR_NAME : (doctorNames.get(f.doctorId) ?? f.doctorId);
    sheet.addRow({
      month: f.month,
      measure: f.measure,
      amount: isCount ? null : paiseToRupees(f.amountPaise),
      count: isCount ? f.amountPaise : null,
      doctor: escapeCell(doctor),
      department: escapeCell(f.departmentId ?? '') || null,
      sponsor: escapeCell(f.sponsor ?? '') || null,
      source: f.sourceId,
      file: escapeCell(f.sourceFile),
      row: f.sourceRow,
      ref: escapeCell(f.ref ?? '') || null,
      umrno: escapeCell(f.umrno ?? '') || null,
      date: f.txnDate,
      attribution: f.attributionStatus ?? null,
      method: f.attributionMethod ?? null,
    });
  }
  styleHeader(sheet);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
}
