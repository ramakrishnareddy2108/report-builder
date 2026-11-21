// runMonth task: read each needed source file through its confirmed mapping,
// then build the month's fact rows and diagnostics. Runs in the worker.

import { buildRun, type ReadSource, type RunOutput, type RunSettings } from '@/core/runMonth';
import { requiredFields } from '@/core/rules';
import type { SourceId } from '@/core/types';
import type { TaskProgress } from '../protocol';
import { readSourceFile } from './readSource';

export type RunMonthRequest = {
  /** 'YYYY-MM'. */
  month: string;
  /** One file per source. */
  files: { sourceId: SourceId; file: File }[];
  settings: RunSettings;
};

export async function runMonthTask(req: RunMonthRequest, onProgress: (p: TaskProgress) => void = () => {}): Promise<RunOutput> {
  const { settings } = req;
  const read: ReadSource[] = [];
  // Sources no rule uses are not read at all.
  const files = req.files.filter((f) => requiredFields(settings.rules, f.sourceId).size > 0);

  for (const [i, { sourceId, file }] of files.entries()) {
    const mapping = settings.sources.sources.find((m) => m.sourceId === sourceId);
    const base = { sourceId, fileName: file.name, sizeBytes: file.size };
    if (!mapping) {
      // Never guess a mapping: an unconfirmed source is reported, not read.
      read.push({
        ...base,
        status: 'flagged',
        sha256: '',
        problems: [{ field: 'ref', message: 'The mapping for this source has not been confirmed. Confirm it on the Sources page.', missingColumns: [] }],
      });
      continue;
    }
    const result = await readSourceFile(
      { sourceId, file, mapping, required: [...requiredFields(settings.rules, sourceId)] },
      onProgress,
      { from: (i / files.length) * 0.95, to: ((i + 1) / files.length) * 0.95 },
    );
    read.push(
      result.ok
        ? { ...base, status: 'read', sha256: result.sha256, mapped: result.mapped }
        : { ...base, status: 'flagged', sha256: result.sha256, problems: result.problems },
    );
  }

  onProgress({ stage: 'Applying the rules', fraction: 0.96 });
  const output = buildRun({ month: req.month, settings, read });
  onProgress({ stage: 'Done', fraction: 1 });
  return output;
}
