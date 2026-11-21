// What the Sources tab does when the user adds a file or ticks a column, as plain functions.

import { normaliseFileName } from '@/engine/assignFiles';
import { columnLetter } from '@/excel/detectHeader';
import { isPatientColumn } from '@/excel/patient';
import { guessType, idFromLabel, labelFromFileName, suggestName, uniqueSourceId } from '@/recipe/guess';
import type { SourceDef } from '@/recipe/schema';
import type { Sample } from './sample';

/** How a column is written into the recipe: its header, or its letter when the header is blank. */
export function fromFor(sample: Pick<Sample, 'headers' | 'rawHeaders'>, i: number): string {
  return sample.rawHeaders[i] === '' ? columnLetter(i) : (sample.headers[i] as string);
}

/** The recipe entry for ticking column `i`: a suggested common name and a guessed type. */
export function pickedColumn(sample: Pick<Sample, 'headers' | 'rawHeaders' | 'rows'>, i: number, others: readonly Pick<SourceDef, 'columns'>[]): SourceDef['columns'][number] {
  const header = sample.headers[i] as string;
  return { from: fromFor(sample, i), as: suggestName(header, others), type: guessType(header, sample.rows.map((r) => r[i] ?? null)) };
}

/** Columns "Pick all" adds: every column not yet picked, except patient details and empty unnamed columns. */
export function pickableColumns(sample: Pick<Sample, 'headers' | 'rawHeaders' | 'rows'>, already: ReadonlySet<number>): number[] {
  return sample.headers.flatMap((h, i) => {
    if (already.has(i) || isPatientColumn(sample.rawHeaders[i] ?? h)) return [];
    const empty = sample.rows.every((r) => r[i] === null || r[i] === undefined || r[i] === '');
    return empty && sample.rawHeaders[i] === '' ? [] : [i];
  });
}

/** A new source for a sample file that fits no existing source. Columns are picked afterwards. */
export function createSourceFromSample(fileName: string, sample: Pick<Sample, 'sheet' | 'headerRow'>, takenIds: readonly string[]): SourceDef {
  const label = labelFromFileName(fileName);
  return {
    id: uniqueSourceId(takenIds, idFromLabel(label)),
    label,
    required: true,
    match: { namePattern: normaliseFileName(fileName), requiredHeaders: [] },
    sheet: sample.sheet ? { name: sample.sheet } : {},
    headerRow: sample.headerRow ?? 'auto',
    columns: [],
    calculated: [],
  };
}
