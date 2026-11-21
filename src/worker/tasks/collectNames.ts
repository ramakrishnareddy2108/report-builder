// Scan the loaded files for the doctor, department and sponsor names they use
// (with counts), so the user can group them. Only names and counts leave the
// worker; no rows do.

import { NameCounter, type RawName } from '@/core/doctors';
import type { SourceId } from '@/core/types';
import type { TaskProgress } from '../protocol';
import { readSourceFile, type SourceInput } from './readSource';

export type CollectNamesRequest = { sources: SourceInput[] };

export type ScannedSource = {
  sourceId: SourceId;
  fileName: string;
  /** Data rows used (0 when the source was not scanned). */
  rows: number;
  status: 'scanned' | 'flagged' | 'noNames';
  message?: string;
};

export type CollectNamesResult = {
  doctors: RawName[];
  departments: RawName[];
  sponsors: RawName[];
  sources: ScannedSource[];
};

export async function collectNamesTask(
  req: CollectNamesRequest,
  onProgress: (p: TaskProgress) => void = () => {},
): Promise<CollectNamesResult> {
  const doctors = new NameCounter();
  const departments = new NameCounter();
  const sponsors = new NameCounter();
  const sources: ScannedSource[] = [];
  const n = req.sources.length;

  for (const [i, input] of req.sources.entries()) {
    const read = await readSourceFile(input, onProgress, { from: i / n, to: (i + 1) / n });
    const base = { sourceId: input.sourceId, fileName: read.fileName };
    if (!read.ok) {
      sources.push({ ...base, rows: 0, status: 'flagged', message: read.problems.map((p) => p.message).join(' ') });
      continue;
    }
    const { fields } = input.mapping;
    if (!fields.doctor && !fields.department && !fields.sponsor) {
      sources.push({ ...base, rows: 0, status: 'noNames', message: 'This source has no doctor, department or sponsor column mapped.' });
      continue;
    }
    for (const row of read.mapped.rows) {
      const { doctor, department, sponsor } = row.values;
      if (typeof doctor === 'string') doctors.add(doctor, typeof department === 'string' ? department : null);
      if (typeof department === 'string') departments.add(department);
      if (typeof sponsor === 'string') sponsors.add(sponsor);
    }
    sources.push({ ...base, rows: read.mapped.rows.length, status: 'scanned' });
  }
  onProgress({ stage: 'Done', fraction: 1 });
  return { doctors: doctors.toArray(), departments: departments.toArray(), sponsors: sponsors.toArray(), sources };
}
