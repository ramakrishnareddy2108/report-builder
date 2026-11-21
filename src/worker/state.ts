// What the worker remembers between tasks, in memory only (never stored):
//  - the last combined table, so "Download combined data" needs no round trip
//  - opened workbooks, so a preview that is re-run after every edit does not re-read the same big file each time

import type * as XLSX from 'xlsx';
import type { CombinedTable } from '@/engine/types';
import { openWorkbook } from '@/excel/readWorkbook';

let lastCombined: CombinedTable | null = null;

export const setLastCombined = (table: CombinedTable | null): void => {
  lastCombined = table;
};
export const getLastCombined = (): CombinedTable | null => lastCombined;

const MAX_WORKBOOKS = 12;
const workbooks = new Map<string, XLSX.WorkBook>();

/** A File arrives as a fresh copy with every message, so files are told apart by name, size and date. */
const keyOf = (file: File) => `${file.name}|${file.size}|${file.lastModified}`;

export async function workbookFor(file: File): Promise<XLSX.WorkBook> {
  const key = keyOf(file);
  const hit = workbooks.get(key);
  if (hit) {
    workbooks.delete(key); // most recently used goes last
    workbooks.set(key, hit);
    return hit;
  }
  const wb = openWorkbook(new Uint8Array(await file.arrayBuffer()));
  workbooks.set(key, wb);
  while (workbooks.size > MAX_WORKBOOKS) workbooks.delete(workbooks.keys().next().value as string);
  return wb;
}

/** Forget everything (for tests). */
export function clearWorkerState(): void {
  lastCombined = null;
  workbooks.clear();
}
