// Dashboard tasks: read saved report files into rows, and write a tile's table to Excel.

import { readOutputFile, stackData, type DashboardData } from '@/dashboard/data';
import { buildTableWorkbook, type TableExportInput } from '@/excel/tableSheet';
import { WorkbookReadError } from '@/excel/readWorkbook';
import type { Recipe } from '@/recipe/schema';

export type ReadOutputsRequest = {
  files: File[];
  /** The recipe linked to the dashboard: gives column types and where the table starts. */
  recipe: Pick<Recipe, 'report' | 'output'> | null;
};

export async function readOutputsTask(req: ReadOutputsRequest): Promise<DashboardData> {
  const parts: DashboardData[] = [];
  for (const file of req.files) {
    try {
      parts.push(readOutputFile(new Uint8Array(await file.arrayBuffer()), { fileName: file.name, recipe: req.recipe }));
    } catch (err) {
      const message = err instanceof WorkbookReadError ? err.message : 'This file could not be read.';
      parts.push({ columns: [], rows: [], sources: [{ name: file.name, rows: 0, skipped: 0, period: '', message }] });
    }
  }
  return stackData(parts);
}

export function exportTableTask(req: TableExportInput): Promise<Uint8Array> {
  return buildTableWorkbook(req);
}
