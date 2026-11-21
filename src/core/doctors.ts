// Doctor, department and sponsor names: normalising, grouping and matching.
//
// HIS exports spell the same doctor many ways (" dr. a  kumar", "A.KUMAR").
// Names are matched in this order: exact alias, then normalised alias, else
// unmatched. An unmatched doctor is never created silently; it goes to Checks.

import { UNATTRIBUTED_DOCTOR_ID, type DoctorMaster, type NameGroup } from './types';

// ---------------------------------------------------------------------------
// Normalising
// ---------------------------------------------------------------------------

export type NormalisedName = {
  /** Comparison key: upper case, no dots or commas, no leading "DR", suffix kept. */
  key: string;
  /** The key without a trailing "(...)" suffix. */
  base: string;
  /** Text of a trailing "(...)" suffix such as REVIEW, flagged for the user; null if none. */
  suffix: string | null;
};

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
const SUFFIX = /\s*\(([^()]*)\)\s*$/;
const LEADING_DR = /^dr\b\.?\s*/i;

/**
 * Trim, collapse spaces, upper-case, turn dots and commas into spaces ("K.KRISHNA"
 * and "K. KRISHNA" meet), and strip a leading "DR". A trailing "(REVIEW)" is
 * kept in the key but reported as `suffix` so it can be flagged.
 */
export function normaliseName(raw: string): NormalisedName {
  const text = collapse(raw.toUpperCase().replace(/[.,]/g, ' '));
  const suffixMatch = SUFFIX.exec(text);
  const suffix = suffixMatch ? collapse(suffixMatch[1] as string) : null;
  const withoutSuffix = collapse(suffixMatch ? text.slice(0, suffixMatch.index) : text);
  const base = collapse(withoutSuffix.replace(/^DR\b\s*/, ''));
  return { key: suffix ? `${base} (${suffix})` : base, base, suffix };
}

/** Department and sponsor comparison key: trimmed, single spaces, upper case. */
export function normaliseLabel(raw: string): string {
  return collapse(raw).toUpperCase();
}

/** A name for people to read: trimmed, single spaces, no trailing dot or comma. */
export function tidyName(raw: string): string {
  return collapse(raw).replace(/[.,\s]+$/, '');
}

// ---------------------------------------------------------------------------
// Matching doctors at run time
// ---------------------------------------------------------------------------

export type DoctorMatch =
  | { status: 'matched'; doctor: DoctorMaster; how: 'exact' | 'normalised' }
  | { status: 'ambiguous'; doctors: DoctorMaster[] }
  | { status: 'unmatched' };

export class DoctorMatcher {
  private readonly exact = new Map<string, DoctorMaster>();
  private readonly normalised = new Map<string, Set<DoctorMaster>>();
  /** Normalised names that belong to more than one doctor (shown to the user to fix). */
  readonly conflicts: string[] = [];

  constructor(doctors: readonly DoctorMaster[]) {
    for (const d of doctors) {
      // A doctor is also known by their display name.
      for (const name of [d.displayName, ...d.aliases]) {
        const trimmed = name.trim();
        if (!this.exact.has(trimmed)) this.exact.set(trimmed, d);
        const key = normaliseName(name).key;
        if (key === '') continue;
        const owners = this.normalised.get(key) ?? new Set<DoctorMaster>();
        owners.add(d);
        this.normalised.set(key, owners);
      }
    }
    for (const [key, owners] of this.normalised) if (owners.size > 1) this.conflicts.push(key);
  }

  match(raw: string): DoctorMatch {
    const trimmed = raw.trim();
    // An exact spelling wins, unless two doctors claim its normalised form.
    const key = normaliseName(raw).key;
    const owners = this.normalised.get(key);
    if (owners && owners.size > 1) return { status: 'ambiguous', doctors: [...owners] };
    const exact = this.exact.get(trimmed);
    if (exact) return { status: 'matched', doctor: exact, how: 'exact' };
    const only = owners ? [...owners][0] : undefined;
    return only ? { status: 'matched', doctor: only, how: 'normalised' } : { status: 'unmatched' };
  }
}

// ---------------------------------------------------------------------------
// Departments and sponsors: canonical name + aliases (optional grouping)
// ---------------------------------------------------------------------------

export type ResolvedLabel = {
  /** Stable key used on fact rows: the normalised canonical name. */
  key: string;
  /** Name shown in reports. */
  name: string;
  /** True when a saved group matched; false when it is the spelling as found. */
  grouped: boolean;
};

export class GroupResolver {
  private readonly byKey = new Map<string, NameGroup>();

  constructor(groups: readonly NameGroup[]) {
    for (const g of groups) {
      for (const name of [g.name, ...g.aliases]) {
        const key = normaliseLabel(name);
        if (key !== '' && !this.byKey.has(key)) this.byKey.set(key, g);
      }
    }
  }

  /** Never fails: a name with no group stands for itself (so no data is lost). */
  resolve(raw: string): ResolvedLabel {
    const key = normaliseLabel(raw);
    const group = this.byKey.get(key);
    if (group) return { key: normaliseLabel(group.name), name: group.name, grouped: true };
    return { key, name: key, grouped: false };
  }
}

// ---------------------------------------------------------------------------
// Collecting raw names from the loaded files
// ---------------------------------------------------------------------------

export type RawName = {
  /** The name as written in the file (trimmed). */
  raw: string;
  count: number;
  /** For doctors: how often each raw department spelling appeared with this name. */
  departments: Record<string, number>;
};

export class NameCounter {
  private readonly names = new Map<string, RawName>();

  add(raw: string, department: string | null = null): void {
    const name = raw.trim();
    if (name === '') return;
    let entry = this.names.get(name);
    if (!entry) {
      entry = { raw: name, count: 0, departments: {} };
      this.names.set(name, entry);
    }
    entry.count++;
    if (department && department.trim() !== '') {
      const d = department.trim();
      entry.departments[d] = (entry.departments[d] ?? 0) + 1;
    }
  }

  toArray(): RawName[] {
    return [...this.names.values()].sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw));
  }
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export type DoctorSuggestion = {
  /** Normalised name that groups the spellings. */
  key: string;
  displayName: string;
  /** Default department: the most frequent one for this doctor (as found). */
  department: string | null;
  /** Raw spellings in this group. */
  aliases: RawName[];
  count: number;
  /** Trailing "(...)" such as REVIEW: flagged for the user. */
  suffix: string | null;
  /** When a "(REVIEW)" variant has a plain-name group, that group's key: a likely same doctor. */
  mergeSuggestion: string | null;
};

function mostFrequent(counts: ReadonlyMap<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [name, n] of counts) {
    if (n > bestCount || (n === bestCount && best !== null && name < best)) {
      best = name;
      bestCount = n;
    }
  }
  return best;
}

/** Display name for a group: the most common spelling without a suffix, tidied. */
export function chooseDisplayName(names: readonly RawName[]): string {
  const counts = new Map<string, number>();
  for (const n of names) {
    const tidy = tidyName(n.raw.replace(SUFFIX, ''));
    const spelling = tidy.replace(LEADING_DR, '') || tidy; // "Dr." is not part of the name in reports
    counts.set(spelling, (counts.get(spelling) ?? 0) + n.count);
  }
  return mostFrequent(counts) ?? tidyName(names[0]?.raw ?? '');
}

/** Most frequent department among the spellings, using the group resolver's canonical name. */
export function defaultDepartment(names: readonly RawName[], departments: GroupResolver): string | null {
  const counts = new Map<string, number>();
  for (const n of names) {
    for (const [dept, c] of Object.entries(n.departments)) {
      const name = departments.resolve(dept).name;
      counts.set(name, (counts.get(name) ?? 0) + c);
    }
  }
  return mostFrequent(counts);
}

/**
 * Group the raw names that no doctor in the master matches yet by normalised
 * name. Names already matched are left out, so a new month only shows new names.
 */
export function suggestDoctors(
  names: readonly RawName[],
  master: readonly DoctorMaster[],
  departments: GroupResolver = new GroupResolver([]),
): DoctorSuggestion[] {
  const matcher = new DoctorMatcher(master);
  const groups = new Map<string, RawName[]>();
  for (const n of names) {
    if (matcher.match(n.raw).status !== 'unmatched') continue;
    const key = normaliseName(n.raw).key;
    if (key === '') continue;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }

  return [...groups.entries()]
    .map(([key, aliases]): DoctorSuggestion => {
      const { base, suffix } = normaliseName(key);
      return {
        key,
        displayName: chooseDisplayName(aliases),
        department: defaultDepartment(aliases, departments),
        aliases,
        count: aliases.reduce((sum, a) => sum + a.count, 0),
        suffix,
        mergeSuggestion: suffix && base !== key && (groups.has(base) || matcher.match(base).status === 'matched') ? base : null,
      };
    })
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** One suggested group of departments or sponsors. */
export type GroupSuggestion = { key: string; name: string; aliases: RawName[]; count: number };

/** Group raw department or sponsor spellings by normalised name, leaving out ones a saved group already covers. */
export function suggestGroups(names: readonly RawName[], existing: readonly NameGroup[]): GroupSuggestion[] {
  const resolver = new GroupResolver(existing);
  const groups = new Map<string, RawName[]>();
  for (const n of names) {
    if (resolver.resolve(n.raw).grouped) continue;
    const key = normaliseLabel(n.raw);
    if (key === '') continue;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  return [...groups.entries()]
    .map(([key, aliases]) => ({
      key,
      name: chooseDisplayName(aliases),
      aliases,
      count: aliases.reduce((sum, a) => sum + a.count, 0),
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Editing the master
// ---------------------------------------------------------------------------

/** URL-friendly id from a name, unique among `taken`. */
export function makeDoctorId(displayName: string, taken: ReadonlySet<string>): string {
  const slug =
    normaliseName(displayName)
      .base.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'doctor';
  let id = slug;
  for (let n = 2; taken.has(id) || id === UNATTRIBUTED_DOCTOR_ID; n++) id = `${slug}-${n}`;
  return id;
}

/** Add suggestions to the master as new doctors. Returns a new list. */
export function acceptSuggestions(master: readonly DoctorMaster[], suggestions: readonly DoctorSuggestion[]): DoctorMaster[] {
  const taken = new Set(master.map((d) => d.id));
  const added = suggestions.map((s): DoctorMaster => {
    const id = makeDoctorId(s.displayName, taken);
    taken.add(id);
    return { id, displayName: s.displayName, department: s.department, aliases: s.aliases.map((a) => a.raw) };
  });
  return [...master, ...added];
}

/** Combine suggestions into one (the first one's name and department win). */
export function mergeSuggestions(group: readonly DoctorSuggestion[]): DoctorSuggestion {
  const [first, ...rest] = group;
  if (!first) throw new Error('mergeSuggestions needs at least one suggestion');
  return {
    ...first,
    aliases: [...first.aliases, ...rest.flatMap((s) => s.aliases)],
    count: group.reduce((sum, s) => sum + s.count, 0),
    mergeSuggestion: null,
  };
}

/** Split a suggestion into one suggestion per raw spelling. */
export function splitSuggestion(s: DoctorSuggestion): DoctorSuggestion[] {
  if (s.aliases.length < 2) return [s];
  return s.aliases.map((a) => ({
    key: a.raw,
    displayName: tidyName(a.raw),
    department: s.department,
    aliases: [a],
    count: a.count,
    suffix: s.suffix,
    mergeSuggestion: null,
  }));
}

/** Add group suggestions to a department or sponsor list. Returns a new list. */
export function acceptGroupSuggestions(existing: readonly NameGroup[], suggestions: readonly GroupSuggestion[]): NameGroup[] {
  return [...existing, ...suggestions.map((s) => ({ name: s.name, aliases: s.aliases.map((a) => a.raw) }))];
}

/** Give an existing doctor more spellings (skipping ones they already have). */
export function addAliases(master: readonly DoctorMaster[], doctorId: string, aliases: readonly string[]): DoctorMaster[] {
  return master.map((d) =>
    d.id === doctorId ? { ...d, aliases: [...d.aliases, ...aliases.filter((a) => !d.aliases.includes(a))] } : d,
  );
}

/** Unlink one spelling from a doctor: it becomes unmatched (and suggested) again. */
export function removeAlias(master: readonly DoctorMaster[], doctorId: string, alias: string): DoctorMaster[] {
  return master.map((d) => (d.id === doctorId ? { ...d, aliases: d.aliases.filter((a) => a !== alias) } : d));
}

export function updateDoctor(
  master: readonly DoctorMaster[],
  doctorId: string,
  patch: Partial<Pick<DoctorMaster, 'displayName' | 'department'>>,
): DoctorMaster[] {
  return master.map((d) => (d.id === doctorId ? { ...d, ...patch } : d));
}

/** Rename a department or sponsor group. */
export function renameGroup(groups: readonly NameGroup[], name: string, newName: string): NameGroup[] {
  return groups.map((g) => (g.name === name ? { ...g, name: newName } : g));
}

/** Unlink one spelling from a group. */
export function removeGroupAlias(groups: readonly NameGroup[], name: string, alias: string): NameGroup[] {
  return groups.map((g) => (g.name === name ? { ...g, aliases: g.aliases.filter((a) => a !== alias) } : g));
}

/** Combine suggestions of departments or sponsors into one (the first one's name wins). */
export function mergeGroupSuggestions(group: readonly GroupSuggestion[]): GroupSuggestion {
  const [first, ...rest] = group;
  if (!first) throw new Error('mergeGroupSuggestions needs at least one suggestion');
  return { ...first, aliases: [...first.aliases, ...rest.flatMap((s) => s.aliases)], count: group.reduce((n, s) => n + s.count, 0) };
}
