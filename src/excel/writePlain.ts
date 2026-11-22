// Plain output: one report sheet, plus the optional Checks and Combined sheets.

import ExcelJS from 'exceljs';
import type { Check } from '@/engine/checks';
import type { ReportResult } from '@/engine/report';
import type { IntermediateSheet } from '@/engine/intermediate';
import type { CombinedTable, SourceSummary } from '@/engine/types';
import { escapeCell } from './escape';
import { NUMBER_FORMATS, toCellValue, uniqueSheetName } from './cells';

const MAX_DETAIL_LINES = 25;

function styleHeader(sheet: ExcelJS.Worksheet, row = 1): void {
  const header = sheet.getRow(row);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    cell.border = { bottom: { style: 'thin' } };
  });
  sheet.views = [{ state: 'frozen', ySplit: row }];
}

/** The report as a plain sheet: header, rows, optional bold totals row. Money is written in rupees. */
export function addReportSheet(workbook: ExcelJS.Workbook, name: string, report: ReportResult): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook.worksheets.map((s) => s.name), name));
  sheet.addRow(report.columns.map((c) => escapeCell(c.name)));
  styleHeader(sheet);
  for (const row of report.rows) sheet.addRow(report.columns.map((c) => toCellValue(row[c.name], c.type)));
  if (report.totals) {
    const t = sheet.addRow(report.columns.map((c) => toCellValue(report.totals?.[c.name], c.type)));
    t.font = { bold: true };
    t.eachCell((cell) => {
      cell.border = { top: { style: 'thin' } };
    });
  }
  report.columns.forEach((c, i) => {
    const col = sheet.getColumn(i + 1);
    const fmt = NUMBER_FORMATS[c.type];
    if (fmt) col.numFmt = fmt;
    const longest = Math.max(c.name.length, ...report.rows.slice(0, 200).map((r) => String(r[c.name] ?? '').length));
    col.width = Math.min(Math.max(longest + 2, 10), c.type === 'text' ? 40 : 18);
  });
  return sheet;
}

/** A sheet listing every check: level, check, message, numbers and details with file and row. */
export function addChecksSheet(workbook: ExcelJS.Workbook, checks: readonly Check[]): void {
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook.worksheets.map((s) => s.name), 'Checks'));
  sheet.columns = [
    { header: 'Level', key: 'level', width: 10 },
    { header: 'Check', key: 'title', width: 38 },
    { header: 'Message', key: 'message', width: 80 },
    { header: 'Rows', key: 'rows', width: 8 },
    { header: 'Amount (₹)', key: 'amount', width: 16, style: { numFmt: '#,##0.00' } },
    { header: 'Details', key: 'details', width: 70 },
  ];
  for (const c of checks) {
    const details = (c.details ?? []).slice(0, c.detailLimit ?? MAX_DETAIL_LINES).map((d) => `${d.file ? `${d.file} ` : ''}${d.row !== undefined ? `row ${d.row}: ` : ''}${d.text}`);
    const more = (c.details?.length ?? 0) - details.length;
    sheet.addRow({
      level: c.level,
      title: escapeCell(c.title),
      message: escapeCell(c.message),
      rows: c.rows ?? null,
      amount: c.amountPaise === undefined ? null : c.amountPaise / 100,
      details: escapeCell(details.join('\n') + (more > 0 ? `\n… and ${more} more` : '')) || null,
    });
  }
  styleHeader(sheet);
  sheet.eachRow((row, n) => {
    if (n > 1) row.alignment = { vertical: 'top', wrapText: true };
  });
}

/** Every combined row, so any number in the report can be traced to a file and an Excel row. */
export function addCombinedSheet(workbook: ExcelJS.Workbook, table: CombinedTable): void {
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook.worksheets.map((s) => s.name), 'Combined'));
  sheet.addRow(table.columns.map((c) => escapeCell(c.name)));
  styleHeader(sheet);
  for (const row of table.rows) sheet.addRow(table.columns.map((c) => toCellValue(row[c.name], c.type)));
  table.columns.forEach((c, i) => {
    const fmt = NUMBER_FORMATS[c.type];
    if (fmt) sheet.getColumn(i + 1).numFmt = fmt;
    sheet.getColumn(i + 1).width = c.type === 'text' ? 24 : 14;
  });
}

/** One sheet per source (only the selected columns) so each export can be checked on its own before the report. */
export function addSourceSheet(workbook: ExcelJS.Workbook, source: IntermediateSheet): void {
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook.worksheets.map((s) => s.name), source.label));
  sheet.addRow(source.columns.map((c) => escapeCell(c.name)));
  styleHeader(sheet);
  for (const row of source.rows) sheet.addRow(source.columns.map((c) => toCellValue(row[c.name], c.type)));
  source.columns.forEach((c, i) => {
    const col = sheet.getColumn(i + 1);
    const fmt = NUMBER_FORMATS[c.type];
    if (fmt) col.numFmt = fmt;
    const longest = Math.max(c.name.length, ...source.rows.slice(0, 200).map((r) => String(r[c.name] ?? '').length));
    col.width = Math.min(Math.max(longest + 2, 10), c.type === 'text' ? 40 : 18);
  });
}

/** The first sheet of the intermediate workbook: which file fed which sheet and how many rows were kept. */
export function addIntermediateSummarySheet(workbook: ExcelJS.Workbook, sheets: readonly IntermediateSheet[], summaries: readonly Pick<SourceSummary, 'sourceId' | 'sheet' | 'headerRow' | 'stats'>[]): void {
  const sheet = workbook.addWorksheet(uniqueSheetName(workbook.worksheets.map((s) => s.name), 'Summary'), { properties: { tabColor: { argb: 'FF888888' } } });
  sheet.columns = [
    { header: 'Sheet', key: 'sheet', width: 28 },
    { header: 'File', key: 'file', width: 46 },
    { header: 'Sheet in the file', key: 'inFile', width: 22 },
    { header: 'Header row', key: 'header', width: 12 },
    { header: 'Rows read', key: 'read', width: 12 },
    { header: 'Left out by the row filter', key: 'filtered', width: 26 },
    { header: 'Rows kept', key: 'kept', width: 12 },
    { header: 'Columns kept', key: 'cols', width: 70 },
  ];
  for (const s of sheets) {
    const info = summaries.find((x) => x.sourceId === s.sourceId);
    sheet.addRow({
      sheet: escapeCell(s.label),
      file: s.fileName ? escapeCell(s.fileName) : 'No file added (optional source)',
      inFile: info ? escapeCell(info.sheet) : null,
      header: info?.headerRow ?? null,
      read: info?.stats.read ?? null,
      filtered: info?.stats.filtered ?? null,
      kept: s.rows.length,
      cols: escapeCell(s.columns.map((c) => c.name).join(', ')),
    });
  }
  styleHeader(sheet);
  sheet.eachRow((row, n) => {
    if (n > 1) row.alignment = { vertical: 'top', wrapText: true };
  });
}

export async function workbookBytes(workbook: ExcelJS.Workbook): Promise<Uint8Array> {
  return new Uint8Array((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
}
