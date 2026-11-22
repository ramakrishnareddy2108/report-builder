// Pipeline step 6: clean up names (doctors, departments, sponsors ...) so spelling variants group together.
//
// For each rule, every value of the column is normalised into a KEY. The steps, in order:
//   1. dots → spaces (option)           "K.KRISHNA CHAND"           → "K KRISHNA CHAND"
//   2. remove the listed characters
//   3. collapse spaces, trim
//   4. strip a trailing text (option)    "SRIMANNARAYANA (REVIEW)"   → "SRIMANNARAYANA"
//   5. strip a leading "DR " (option)    "DR SRIMANNARAYANA"         → "SRIMANNARAYANA"
// and the key ignores case when asked. A strip never leaves an empty name: if nothing would be left, the text is
// kept as it was. Values with the same key become one name. An explicit alias
// ("treat as same") maps several spellings onto one name. The name that is written back is, in order:
// the alias target, else the most common spelling in the data, shown in the rule's display case.
//
// The result is informational too: every raw → clean mapping, and the names that no alias touched, so the
// Checks can show what happened. Nothing is dropped: a value is only ever replaced by its clean name.

import type { CleanupRule } from '@/recipe/schema';
import type { CombinedTable, Issue } from './types';

/** Which optional step changed a value (for the preview of affected values). */
export type CleanupStep = 'dots' | 'prefix' | 'suffix';

export type CleanupMapping = { raw: string; clean: string; count: number; /** Optional steps that changed this spelling. */ steps?: CleanupStep[] };

export type CleanupReport = {
  column: string;
  /** Distinct raw spellings before cleanup. */
  rawNames: number;
  /** Distinct names after cleanup. */
  cleanNames: number;
  /** Every raw → clean mapping that changed the text, with how many rows it covers. */
  mappings: CleanupMapping[];
  /** Every distinct raw spelling with its clean name and row count (changed or not). */
  values: CleanupMapping[];
  /** Pairs of clean names that look like the same person or place: worth a look. */
  suspicious: SuspiciousPair[];
  /** Clean names that no alias touched (informational: normalising already groups them). */
  unmatchedByAlias: { name: string; count: number }[];
  /** Rows whose value in this column is blank (left blank). */
  blankRows: number;
};

export type SuspiciousPair = { a: string; b: string; reason: string };

export type CleanupResult = { reports: CleanupReport[]; issues: Issue[] };

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The text after the rule's steps (case kept) and the optional steps that changed it. */
export function cleanText(raw: string, rule: Pick<CleanupRule, 'normalize'>): { text: string; steps: CleanupStep[] } {
  const n = rule.normalize;
  const steps: CleanupStep[] = [];
  const base = (input: string): string => {
    let t = input;
    if (n.dotsToSpace) t = t.split('.').join(' ');
    for (const ch of n.removeChars) t = t.split(ch).join('');
    return collapse(t);
  };

  let s = base(raw);
  if (n.dotsToSpace && raw.includes('.')) steps.push('dots');

  const suffix = n.stripSuffix;
  if (suffix?.enabled) {
    const tail = base(suffix.text).toLowerCase();
    if (tail !== '' && s.toLowerCase().endsWith(tail)) {
      const rest = collapse(s.slice(0, s.length - tail.length));
      if (rest !== '') {
        s = rest;
        steps.push('suffix');
      }
    }
  }
  if (n.stripDrPrefix) {
    const m = /^dr\s+(.+)$/i.exec(s);
    if (m) {
      s = collapse(m[1] as string);
      steps.push('prefix');
    }
  }
  return { text: s, steps };
}

function normaliseKey(raw: string, rule: CleanupRule): string {
  const { text } = cleanText(raw, rule);
  return rule.normalize.ignoreCase ? text.toLowerCase() : text;
}

/** The text with the rule's steps applied, keeping the original case. */
function tidy(raw: string, rule: CleanupRule): string {
  return cleanText(raw, rule).text;
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

const MAX_NAMES_FOR_PAIRS = 1500;
const MAX_PAIRS = 50;

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Names that probably mean the same thing: the same letters with other spacing or dots, or one name inside the other. */
export function findSuspicious(names: readonly string[]): SuspiciousPair[] {
  if (names.length > MAX_NAMES_FOR_PAIRS) return [];
  const out: SuspiciousPair[] = [];
  const byLetters = new Map<string, string[]>();
  for (const n of names) {
    const key = words(n).join('');
    byLetters.set(key, [...(byLetters.get(key) ?? []), n]);
  }
  for (const group of byLetters.values()) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) out.push({ a: group[i] as string, b: group[j] as string, reason: 'Same letters, different spacing or punctuation' });
  }
  const tokens = names.map((n) => new Set(words(n)));
  for (let i = 0; i < names.length && out.length < MAX_PAIRS; i++) {
    for (let j = 0; j < names.length && out.length < MAX_PAIRS; j++) {
      const a = tokens[i] as Set<string>;
      const b = tokens[j] as Set<string>;
      if (i === j || a.size < 2 || a.size >= b.size || ![...a].every((t) => b.has(t))) continue;
      out.push({ a: names[i] as string, b: names[j] as string, reason: 'One name contains the other' });
    }
  }
  return out.slice(0, MAX_PAIRS);
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
    const valueCount = new Map<string, CleanupMapping>();
    for (const row of table.rows) {
      const v = row[column];
      if (v === null || v === undefined || String(v).trim() === '') continue;
      const raw = String(v);
      let key = normaliseKey(raw, rule);
      const t = aliasTarget.get(key);
      if (t !== undefined) key = normaliseKey(t, rule);
      const clean = cleanOf.get(key) as string;
      row[column] = clean;
      let all = valueCount.get(raw);
      if (!all) {
        const steps = cleanText(raw, rule).steps;
        all = { raw, clean, count: 0, ...(steps.length > 0 ? { steps } : {}) };
        valueCount.set(raw, all);
      }
      all.count++;
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
      values: [...valueCount.values()].sort((a, b) => a.clean.localeCompare(b.clean) || b.count - a.count),
      suspicious: findSuspicious([...cleanOf.values()]),
      unmatchedByAlias: [...groups.entries()]
        .filter(([, g]) => !g.aliased)
        .map(([key, g]) => ({ name: cleanOf.get(key) as string, count: g.rows }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      blankRows,
    });
  }
  return { reports, issues };
}
