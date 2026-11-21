import { describe, expect, it } from 'vitest';
import {
  DoctorMatcher,
  addAliases,
  chooseDisplayName,
  mergeGroupSuggestions,
  removeAlias,
  removeGroupAlias,
  renameGroup,
  updateDoctor,
  GroupResolver,
  NameCounter,
  acceptGroupSuggestions,
  acceptSuggestions,
  makeDoctorId,
  mergeSuggestions,
  normaliseLabel,
  normaliseName,
  splitSuggestion,
  suggestDoctors,
  suggestGroups,
  tidyName,
  type RawName,
} from '@/core/doctors';
import { DoctorsFileSchema } from '@/core/schemas';
import type { DoctorMaster } from '@/core/types';

const raw = (name: string, count = 1, departments: Record<string, number> = {}): RawName => ({ raw: name, count, departments });

describe('normaliseName', () => {
  it.each([
    [' dr. a  kumar ', 'A KUMAR'],
    ['K.KRISHNA CHAND', 'K KRISHNA CHAND'],
    ['K. Krishna  Chand', 'K KRISHNA CHAND'],
    ['G.Ajay Kumar.', 'G AJAY KUMAR'],
    ['DR SRIMANNARAYANA', 'SRIMANNARAYANA'],
    ['Dr.Sindhuri', 'SINDHURI'],
    ['DRAVID KUMAR', 'DRAVID KUMAR'], // "DR" must be a whole word
    ['Smith, John', 'SMITH JOHN'],
    ['   ', ''],
  ])('%j → %j', (input, key) => expect(normaliseName(input).key).toBe(key));

  it('keeps a (REVIEW) suffix in the key but reports it', () => {
    const n = normaliseName(' D. SWETHA ( review ) ');
    expect(n).toEqual({ key: 'D SWETHA (REVIEW)', base: 'D SWETHA', suffix: 'REVIEW' });
    expect(normaliseName('DR SRIMANNARAYANA (REVIEW)')).toMatchObject({ key: 'SRIMANNARAYANA (REVIEW)', suffix: 'REVIEW' });
    expect(normaliseName('A B').suffix).toBeNull();
  });

  it('collapses spellings seen in the October export', () => {
    const spellings = [' AJAY  KUMAR (REVIEW)', 'AJAY  KUMAR (REVIEW)', 'Ajay Kumar (review)'];
    expect(new Set(spellings.map((s) => normaliseName(s).key)).size).toBe(1);
  });
});

describe('labels and names', () => {
  it('normaliseLabel trims, collapses and upper-cases', () => {
    expect(normaliseLabel('  Cardio   logy ')).toBe('CARDIO LOGY');
    expect(normaliseLabel('cardiology')).toBe(normaliseLabel('CARDIOLOGY'));
  });
  it('tidyName drops trailing dots and spaces', () => {
    expect(tidyName('  G.Ajay  Kumar. ')).toBe('G.Ajay Kumar');
  });
});

const master: DoctorMaster[] = [
  { id: 'a-kumar', displayName: 'A Kumar', department: 'Cardiology', aliases: ['Dr. A Kumar', ' dr b kumar'] },
  { id: 'p-lalitha', displayName: 'P Lalitha', department: null, aliases: [] },
];

describe('DoctorMatcher', () => {
  const matcher = new DoctorMatcher(master);

  it('matches an exact alias first', () => {
    expect(matcher.match('Dr. A Kumar')).toMatchObject({ status: 'matched', how: 'exact', doctor: { id: 'a-kumar' } });
    expect(matcher.match('  Dr. A Kumar  ')).toMatchObject({ status: 'matched', how: 'exact' });
  });
  it('then a normalised alias', () => {
    expect(matcher.match('DR.  A.KUMAR')).toMatchObject({ status: 'matched', how: 'normalised', doctor: { id: 'a-kumar' } });
  });
  it('knows a doctor by their display name', () => {
    expect(matcher.match('p lalitha')).toMatchObject({ status: 'matched', doctor: { id: 'p-lalitha' } });
  });
  it('never creates a doctor: an unknown name stays unmatched', () => {
    expect(matcher.match('Somebody New')).toEqual({ status: 'unmatched' });
    expect(matcher.match('')).toEqual({ status: 'unmatched' });
  });
  it('does not match a (REVIEW) variant unless it is an alias', () => {
    expect(matcher.match('A KUMAR (REVIEW)').status).toBe('unmatched');
  });
  it('reports a normalised name claimed by two doctors as ambiguous', () => {
    const two = new DoctorMatcher([
      { id: 'x1', displayName: 'S Rao', department: null, aliases: [] },
      { id: 'x2', displayName: 'Dr. S. Rao', department: null, aliases: [] },
    ]);
    expect(two.conflicts).toEqual(['S RAO']);
    expect(two.match('s rao')).toMatchObject({ status: 'ambiguous' });
  });
});

describe('GroupResolver', () => {
  const resolver = new GroupResolver([{ name: 'Cardiology', aliases: ['CARDIAC', 'Cardiology '] }]);
  it('maps aliases and the name itself to the group, ignoring case', () => {
    expect(resolver.resolve('cardiac')).toEqual({ key: 'CARDIOLOGY', name: 'Cardiology', grouped: true });
    expect(resolver.resolve('CARDIOLOGY')).toMatchObject({ name: 'Cardiology', grouped: true });
  });
  it('lets an ungrouped name stand for itself, so nothing is lost', () => {
    expect(resolver.resolve(' urology ')).toEqual({ key: 'UROLOGY', name: 'UROLOGY', grouped: false });
  });
});

describe('NameCounter', () => {
  it('counts spellings and the departments seen with them, and ignores blanks', () => {
    const c = new NameCounter();
    c.add(' Dr A ', 'Cardiology');
    c.add('Dr A', 'cardiology');
    c.add('Dr A', null);
    c.add('   ');
    expect(c.toArray()).toEqual([{ raw: 'Dr A', count: 3, departments: { Cardiology: 1, cardiology: 1 } }]);
  });
});

describe('suggestDoctors', () => {
  const names = [
    raw(' K.KRISHNA CHAND', 10, { CARDIOLOGY: 10 }),
    raw('K.Krishna Chand', 4, { Cardiology: 4 }),
    raw('K KRISHNA CHAND (REVIEW)', 3, { CARDIOLOGY: 3 }),
    raw('D. SWETHA', 5, { Neurology: 3, Urology: 2 }),
    raw('D. SWETHA (REVIEW)', 1),
    raw('Dr. A Kumar', 8), // already in the master
  ];
  const resolver = new GroupResolver([{ name: 'Cardiology', aliases: ['CARDIOLOGY'] }]);

  it('groups spellings by normalised name and leaves out names the master already matches', () => {
    const out = suggestDoctors(names, master, resolver);
    expect(out.map((s) => s.key)).toEqual(['K KRISHNA CHAND', 'D SWETHA', 'K KRISHNA CHAND (REVIEW)', 'D SWETHA (REVIEW)']);
    expect(out[0]?.aliases.map((a) => a.raw)).toEqual([' K.KRISHNA CHAND', 'K.Krishna Chand']);
    expect(out[0]?.count).toBe(14);
  });

  it('picks the most common spelling as the display name, and the most frequent department', () => {
    const [chand, swetha] = suggestDoctors(names, master, resolver);
    expect(chand?.displayName).toBe('K.KRISHNA CHAND');
    expect(chand?.department).toBe('Cardiology');
    expect(swetha?.department).toBe('NEUROLOGY');
  });

  it('leaves "Dr." out of the display name', () => {
    const [s] = suggestDoctors([raw(' dr. a kumar', 2), raw('DR A KUMAR (REVIEW)', 1)], []);
    expect(s?.displayName).toBe('a kumar');
    expect(chooseDisplayName([raw('Dr', 1)])).toBe('Dr'); // never an empty name
  });

  it('keeps (REVIEW) in the display name, so accepting both gives two distinguishable doctors', () => {
    const out = suggestDoctors([raw('K.Krishna Chand', 5), raw('K.KRISHNA CHAND (REVIEW)', 2)], []);
    expect(out.map((s) => s.displayName)).toEqual(['K.Krishna Chand', 'K.KRISHNA CHAND (REVIEW)']);
    expect(new DoctorMatcher(acceptSuggestions([], out)).conflicts).toEqual([]);
  });

  it('flags (REVIEW) variants and points to a plain-name group', () => {
    const out = suggestDoctors(names, master, resolver);
    const review = out.find((s) => s.key === 'K KRISHNA CHAND (REVIEW)');
    expect(review).toMatchObject({ suffix: 'REVIEW', mergeSuggestion: 'K KRISHNA CHAND' });
    expect(out.find((s) => s.key === 'K KRISHNA CHAND')?.suffix).toBeNull();
  });

  it('suggests nothing once every name is matched', () => {
    const accepted = acceptSuggestions(master, suggestDoctors(names, master, resolver));
    expect(suggestDoctors(names, accepted, resolver)).toEqual([]);
  });
});

describe('editing the master', () => {
  const suggestions = suggestDoctors(
    [raw('Dr. M Rao', 5, { ORTHO: 5 }), raw('M.RAO', 2), raw('M Rao (REVIEW)', 1), raw('S Rao', 3)],
    [],
  );

  it('accepting adds doctors with unique ids and all spellings as aliases', () => {
    const out = acceptSuggestions([{ id: 'm-rao', displayName: 'Old', department: null, aliases: [] }], suggestions);
    expect(out.map((d) => d.id)).toEqual(['m-rao', 'm-rao-2', 's-rao', 'm-rao-3']);
    expect(out[1]?.aliases).toEqual(['Dr. M Rao', 'M.RAO']);
    expect(DoctorsFileSchema.safeParse({ version: 1, doctors: out }).success).toBe(true);
  });

  it('merging combines spellings under the first suggestion', () => {
    const [mrao, , review] = suggestions;
    const merged = mergeSuggestions([mrao!, review!]);
    expect(merged.displayName).toBe(mrao?.displayName);
    expect(merged.aliases.map((a) => a.raw)).toEqual(['Dr. M Rao', 'M.RAO', 'M Rao (REVIEW)']);
    expect(merged.count).toBe(8);
  });

  it('splitting gives one suggestion per spelling', () => {
    const split = splitSuggestion(suggestions[0]!);
    expect(split.map((s) => s.aliases.map((a) => a.raw))).toEqual([['Dr. M Rao'], ['M.RAO']]);
    expect(splitSuggestion(split[0]!)).toHaveLength(1);
  });

  it('makeDoctorId never reuses an id or the reserved pharmacy id', () => {
    expect(makeDoctorId('Dr. K. Krishna Chand', new Set())).toBe('k-krishna-chand');
    expect(makeDoctorId('K Krishna Chand', new Set(['k-krishna-chand']))).toBe('k-krishna-chand-2');
    expect(makeDoctorId('???', new Set())).toBe('doctor');
    expect(makeDoctorId('Pharmacy Unattributed', new Set())).toBe('pharmacy-unattributed-2');
  });
});

describe('departments and sponsors', () => {
  const names = [raw('CARDIOLOGY', 10), raw('Cardiology', 4), raw('cardiology', 1), raw('UROLOGY', 3)];

  it('suggests groups by normalised name, most common spelling as the name', () => {
    const out = suggestGroups(names, []);
    expect(out.map((g) => [g.key, g.name, g.count])).toEqual([
      ['CARDIOLOGY', 'CARDIOLOGY', 15],
      ['UROLOGY', 'UROLOGY', 3],
    ]);
  });

  it('leaves out names a saved group already covers', () => {
    const existing = acceptGroupSuggestions([], suggestGroups(names, []).slice(0, 1));
    expect(existing).toEqual([{ name: 'CARDIOLOGY', aliases: ['CARDIOLOGY', 'Cardiology', 'cardiology'] }]);
    expect(suggestGroups(names, existing).map((g) => g.key)).toEqual(['UROLOGY']);
  });
});

describe('doctors.json schema', () => {
  it('accepts an older file without departments or sponsors', () => {
    const r = DoctorsFileSchema.parse({ version: 1, doctors: [] });
    expect(r.departments).toEqual([]);
    expect(r.sponsors).toEqual([]);
  });
  it('rejects a department alias used by two departments', () => {
    const r = DoctorsFileSchema.safeParse({
      version: 1,
      doctors: [],
      departments: [
        { name: 'Cardiology', aliases: ['CARDIAC'] },
        { name: 'Cardio', aliases: ['cardiac'] },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe('master edits', () => {
  it('adds aliases without duplicates, and removes one', () => {
    const added = addAliases(master, 'a-kumar', ['Dr. A Kumar', 'A.KUMAR (REVIEW)']);
    expect(added[0]?.aliases).toEqual(['Dr. A Kumar', ' dr b kumar', 'A.KUMAR (REVIEW)']);
    expect(removeAlias(added, 'a-kumar', ' dr b kumar')[0]?.aliases).toEqual(['Dr. A Kumar', 'A.KUMAR (REVIEW)']);
    expect(master[0]?.aliases).toHaveLength(2); // the original is untouched
  });
  it('updates a doctor and leaves the others alone', () => {
    const out = updateDoctor(master, 'p-lalitha', { displayName: 'P. Lalitha', department: 'ENT' });
    expect(out[1]).toMatchObject({ displayName: 'P. Lalitha', department: 'ENT' });
    expect(out[0]).toBe(master[0]);
  });
  it('renames a group, unlinks a group alias and merges group suggestions', () => {
    const groups = [{ name: 'Cardiology', aliases: ['CARDIAC', 'CARDIO'] }];
    expect(renameGroup(groups, 'Cardiology', 'Cardiac Care')[0]?.name).toBe('Cardiac Care');
    expect(removeGroupAlias(groups, 'Cardiology', 'CARDIO')[0]?.aliases).toEqual(['CARDIAC']);
    const a = { key: 'A', name: 'A', aliases: [raw('A', 2)], count: 2 };
    const b = { key: 'B', name: 'B', aliases: [raw('B', 3)], count: 3 };
    expect(mergeGroupSuggestions([a, b])).toMatchObject({ name: 'A', count: 5, aliases: [{ raw: 'A' }, { raw: 'B' }] });
  });
});
