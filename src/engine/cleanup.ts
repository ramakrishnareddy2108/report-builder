// Pipeline step 6: clean up names (doctors, departments, sponsors ...) so spelling variants group together.
//
// For each rule, every value of the column is normalised into a KEY (trim, collapse spaces, remove the listed
// characters, and ignore case when asked). Values with the same key become one name. An explicit alias
// ("treat as same") maps several spellings onto one name. The name that is written back is, in order:
// the alias target, else the most common spelling in the data, shown in the rule's display case.
//
// The result is informational too: every raw → clean mapping, and the names that no alias touched, so the
// Checks can show what happened. Nothing is dropped: a value is only ever replaced by its clean name.

import type { CleanupRule } from '@/recipe/schema';
import type { CombinedTable, Issue } from './types';

export type CleanupMapping = { raw: string; clean: string; count: number };

export type CleanupReport = {
  column: string;
  /** Distinct raw spellings before cleanup. */
  rawNames: number;
  /** Distinct names after cleanup. */
  cleanNames: number;
  /** Every raw → clean mapping that changed the text, with how many rows it covers. */
  mappings: CleanupMapping[];
  /** Clean names that no alias touched (informational: normalising already groups them). */
  unmatchedByAlias: { name: string; count: number }[];
  /** Rows whose value in this column is blank (left blank). */
  blankRows: number;
};

export type CleanupResult = { reports: CleanupReport[]; issues: Issue[] };

function normaliseKey(raw: string, rule: CleanupRule): string {
  let s = raw;
  for (const ch of rule.normalize.removeChars) s = s.split(ch).join('');
  s = s.replace(/\s+/g, ' ').trim();
  return rule.normalize.ignoreCase ? s.toLowerCase() : s;
}

/** The text with the rule's removed characters taken out and spaces collapsed, keeping the original case. */
function tidy(raw: string, rule: CleanupRule): string {
  let s = raw;
  for (const ch of rule.normalize.removeChars) s = s.split(ch).join('');
  return s.replace(/\s+/g, ' ').trim();
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());

function display(s: string, rule: CleanupRule): string {
  switch (rule.displayCase) {
    case 'upper':
      return s.toUpperCase();
    case 'title':
      return titleCase(s);
    default:
      return s;
  }
}

/** Cleans the table IN PLACE (rows are ours) and reports what happened. */
export function cleanup(table: CombinedTable, rules: readonly CleanupRule[]): CleanupResult {
  const reports: CleanupReport[] = [];
  const issues: Issue[] = [];
  const names = new Set(table.columns.map((c) => c.name.toUpperCase()));

  for (const rule of rules) {
    if (!names.has(rule.column.toUpperCase())) {
      issues.push({ level: 'error', column: rule.column, message: `Name cleanup: column ${rule.column} does not exist in the combined data. Pick another column in Prepare.` });
      continue;
    }
    const column = table.columns.find((c) => c.name.toUpperCase() === rule.column.toUpperCase())?.name ?? rule.column;

    // alias key → target text
    const aliasTarget = new Map<string, string>();
    for (const a of rule.aliases) {
      aliasTarget.set(normaliseKey(a.to, rule), a.to);
      for (const f of a.from) aliasTarget.set(normaliseKey(f, rule), a.to);
    }

    // pass 1: group raw spellings by key
    type Group = { variants: Map<string, number>; firstSeen: number; aliased: boolean; rows: number };
    const groups = new Map<string, Group>();
    let blankRows = 0;
    const rawNames = new Set<string>();
    table.rows.forEach((row, i) => {
      const v = row[column];
      if (v === null || v === undefined || String(v).trim() === '') {
        blankRows++;
        return;
      }
      const raw = String(v);
      rawNames.add(raw);
      let key = normaliseKey(raw, rule);
      const aliased = aliasTarget.has(key);
      if (aliased) key = normaliseKey(aliasTarget.get(key) as string, rule);
      const g = groups.get(key) ?? { variants: new Map<string, number>(), firstSeen: i, aliased: false, rows: 0 };
      g.variants.set(raw, (g.variants.get(raw) ?? 0) + 1);
      g.aliased ||= aliased;
      g.rows++;
      groups.set(key, g);
    });

    // the written name per group
    const cleanOf = new Map<string, string>();
    for (const [key, g] of groups) {
      const alias = [...aliasTarget.entries()].find(([k]) => k === key)?.[1];
      const target = rule.aliases.find((a) => normaliseKey(a.to, rule) === key)?.to;
      let best = '';
      let bestCount = -1;
      for (const [raw, n] of g.variants) {
        if (n > bestCount) {
          best = raw;
          bestCount = n;
        }
      }
      cleanOf.set(key, display(tidy(target ?? alias ?? best, rule), rule));
    }

    // pass 2: write the clean names back and record the mappings
    const mappingCount = new Map<string, CleanupMapping>();
    for (const row of table.rows) {
      const v = row[column];
      if (v === null || v === undefined || String(v).trim() === '') continue;
      const raw = String(v);
      let key = normaliseKey(raw, rule);
      const t = aliasTarget.get(key);
      if (t !== undefined) key = normaliseKey(t, rule);
      const clean = cleanOf.get(key) as string;
      row[column] = clean;
      if (clean !== raw) {
        const m = mappingCount.get(raw) ?? { raw, clean, count: 0 };
        m.count++;
        mappingCount.set(raw, m);
      }
    }

    reports.push({
      column,
      rawNames: rawNames.size,
      cleanNames: groups.size,
      mappings: [...mappingCount.values()].sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw)),
      unmatchedByAlias: [...groups.entries()]
        .filter(([, g]) => !g.aliased)
        .map(([key, g]) => ({ name: cleanOf.get(key) as string, count: g.rows }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      blankRows,
    });
  }
  return { reports, issues };
}
