// Is a source ready to use? Compares the saved mapping with the file that was loaded.

import type { FieldKey, SourceMapping } from '@/core/types';
import { resolveMapping, type MappingProblem, type SheetHeader } from './mapSource';

export type SourceStatus = 'Not mapped' | 'Ready' | 'Flagged';

export type SourceStatusInfo = {
  status: SourceStatus;
  problems: MappingProblem[];
  /** False when no file has been loaded to check the mapping against. */
  checkedAgainstFile: boolean;
};

export type LoadedSheet = {
  /** Sheet that was read (null when the workbook has none). */
  sheet: string | null;
  sheetNames: readonly string[];
  /** Header found at the mapping's header row of that sheet. */
  header: SheetHeader | null;
};

/**
 * - No saved mapping → Not mapped (a default may pre-fill the editor, but it is not confirmed yet).
 * - Saved mapping, no file yet → Ready (nothing to contradict it).
 * - Saved mapping and a file → Ready if every column, formula and required field fits, else Flagged
 *   with the exact missing columns. A mapping is never adjusted silently.
 */
export function sourceStatus(
  saved: SourceMapping | null,
  loaded: LoadedSheet | null,
  required: ReadonlySet<FieldKey>,
): SourceStatusInfo {
  if (!saved) return { status: 'Not mapped', problems: [], checkedAgainstFile: false };
  if (!loaded) return { status: 'Ready', problems: [], checkedAgainstFile: false };

  if (loaded.sheet !== saved.sheet || !loaded.header) {
    const sheets = loaded.sheetNames.map((s) => `“${s}”`).join(', ');
    return {
      status: 'Flagged',
      checkedAgainstFile: true,
      problems: [
        {
          field: 'ref',
          message: `The sheet “${saved.sheet}” was not found in this file${sheets ? ` (it has ${sheets})` : ''}.`,
          missingColumns: [],
        },
      ],
    };
  }
  const problems = resolveMapping(saved, loaded.header, required).problems;
  return { status: problems.length === 0 ? 'Ready' : 'Flagged', problems, checkedAgainstFile: true };
}
