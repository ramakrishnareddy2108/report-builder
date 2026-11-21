import { useMemo } from 'react';
import { requiredFields } from '@/core/rules';
import { SOURCE_IDS, type FieldKey, type SourceId, type SourceMapping } from '@/core/types';
import { sourceStatus, type SourceStatusInfo } from '@/excel/sourceStatus';
import { fileForSource, useFiles, type LoadedFile } from './filesStore';
import { useSettings } from './settingsStore';

export type SourceInfo = {
  sourceId: SourceId;
  /** The confirmed mapping from settings/sources.json (null = not mapped yet). */
  saved: SourceMapping | null;
  /** The file loaded for this source in this session. */
  file: LoadedFile | null;
  /** Fields the active measure rules need from this source. */
  required: ReadonlySet<FieldKey>;
  status: SourceStatusInfo;
};

/** Status of every source: saved mapping checked against the loaded file. */
export function useSourceInfos(): Record<SourceId, SourceInfo> {
  const sources = useSettings((s) => s.sources);
  const rules = useSettings((s) => s.rules);
  const files = useFiles((s) => s.files);

  return useMemo(() => {
    const out = {} as Record<SourceId, SourceInfo>;
    for (const sourceId of SOURCE_IDS) {
      const saved = sources.sources.find((m) => m.sourceId === sourceId) ?? null;
      const file = fileForSource(files, sourceId);
      const required = requiredFields(rules, sourceId);
      const loaded = file ? { sheet: file.sheet, sheetNames: file.sheets.map((s) => s.name), header: file.header } : null;
      out[sourceId] = { sourceId, saved, file, required, status: sourceStatus(saved, loaded, required) };
    }
    return out;
  }, [sources, rules, files]);
}
