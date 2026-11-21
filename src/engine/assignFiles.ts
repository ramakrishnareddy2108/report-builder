// Pipeline step 1: match uploaded files to the recipe's sources.
//
//  1. By headers: a source matches a file when every one of its `requiredHeaders` is in the file
//     (in the source's sheet when it names one, otherwise in any sheet).
//  2. By file name: `namePattern` against the file name, ignoring month names, years, dates and numbers.
//  3. A file that fits several sources is narrowed with the name pattern. If it is still not clear,
//     or two files want the same source, the app asks the user: nothing is guessed silently.

import type { Recipe, SourceDef } from '@/recipe/schema';

/** What the engine needs to know about an uploaded file. `InspectFileResult` has this shape. */
export type FileProbe = {
  name: string;
  sheets: { name: string; header: { rawHeaders: readonly string[] } | null }[];
};

export type Assignment = {
  sourceId: string;
  fileName: string;
  how: 'headers' | 'name' | 'headers+name';
};

export type AmbiguousFile = {
  fileName: string;
  /** Source ids the file could be. */
  candidates: string[];
  reason: string;
};

export type AssignResult = {
  assignments: Assignment[];
  /** Files that match no source. */
  unassignedFiles: string[];
  missingRequiredSources: string[];
  missingOptionalSources: string[];
  ambiguous: AmbiguousFile[];
};

const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec';

/** "IP Discharge Report Oct2026 (1).xlsx" → "ip discharge report". Months, years, dates and numbers are dropped. */
export function normaliseFileName(name: string): string {
  return name
    .replace(/\.[A-Za-z0-9]{2,5}$/, '')
    .toLowerCase()
    .replace(/\d+/g, ' ')
    .replace(new RegExp(`\\b(${MONTHS})\\b`, 'g'), ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

const fold = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

function matchesHeaders(file: FileProbe, source: SourceDef): boolean {
  const need = source.match.requiredHeaders.map(fold).filter((h) => h !== '');
  if (need.length === 0) return false;
  const wanted = source.sheet.name?.toUpperCase();
  const named = wanted ? file.sheets.filter((s) => s.name.toUpperCase() === wanted) : [];
  const sheets = named.length > 0 ? named : file.sheets;
  return sheets.some((s) => {
    const have = new Set((s.header?.rawHeaders ?? []).map(fold));
    return need.every((h) => have.has(h));
  });
}

function matchesName(file: FileProbe, source: SourceDef): boolean {
  const pattern = normaliseFileName(source.match.namePattern ?? '');
  return pattern !== '' && normaliseFileName(file.name).includes(pattern);
}

export function assignFiles(files: readonly FileProbe[], recipe: Pick<Recipe, 'sources'>): AssignResult {
  const decided = new Map<string, Assignment>(); // by file name
  const ambiguous: AmbiguousFile[] = [];
  const unassigned: string[] = [];

  for (const file of files) {
    const byHeaders = recipe.sources.filter((s) => matchesHeaders(file, s));
    const byName = recipe.sources.filter((s) => matchesName(file, s));

    if (byHeaders.length === 1) {
      const s = byHeaders[0] as SourceDef;
      decided.set(file.name, { sourceId: s.id, fileName: file.name, how: byName.includes(s) ? 'headers+name' : 'headers' });
    } else if (byHeaders.length > 1) {
      const both = byHeaders.filter((s) => byName.includes(s));
      if (both.length === 1) {
        decided.set(file.name, { sourceId: (both[0] as SourceDef).id, fileName: file.name, how: 'headers+name' });
      } else {
        ambiguous.push({
          fileName: file.name,
          candidates: byHeaders.map((s) => s.id),
          reason: 'The columns of this file fit more than one source. Choose which one it is.',
        });
      }
    } else if (byName.length === 1) {
      decided.set(file.name, { sourceId: (byName[0] as SourceDef).id, fileName: file.name, how: 'name' });
    } else if (byName.length > 1) {
      ambiguous.push({
        fileName: file.name,
        candidates: byName.map((s) => s.id),
        reason: 'The file name fits more than one source. Choose which one it is.',
      });
    } else {
      unassigned.push(file.name);
    }
  }

  // Two files for one source: ask, never pick one silently.
  const bySource = new Map<string, Assignment[]>();
  for (const a of decided.values()) bySource.set(a.sourceId, [...(bySource.get(a.sourceId) ?? []), a]);
  const assignments: Assignment[] = [];
  for (const [sourceId, list] of bySource) {
    if (list.length === 1) {
      assignments.push(list[0] as Assignment);
    } else {
      for (const a of list) {
        ambiguous.push({
          fileName: a.fileName,
          candidates: [sourceId],
          reason: `${list.length} files look like the same source (${list.map((x) => x.fileName).join(', ')}). Keep only one.`,
        });
      }
    }
  }

  const assigned = new Set(assignments.map((a) => a.sourceId));
  const pending = new Set(ambiguous.flatMap((a) => a.candidates)); // might still be filled once the user chooses
  const missing = recipe.sources.filter((s) => !assigned.has(s.id) && !pending.has(s.id));

  return {
    assignments: assignments.sort((a, b) => order(recipe, a.sourceId) - order(recipe, b.sourceId)),
    unassignedFiles: unassigned,
    missingRequiredSources: missing.filter((s) => s.required).map((s) => s.id),
    missingOptionalSources: missing.filter((s) => !s.required).map((s) => s.id),
    ambiguous,
  };
}

const order = (recipe: Pick<Recipe, 'sources'>, id: string) => recipe.sources.findIndex((s) => s.id === id);
