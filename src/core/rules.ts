// Measure rules: which source fields each measure needs, and applying the rules
// to mapped source rows to produce fact rows.
//
// Every row offered to a rule term ends up in exactly one place: a fact row, or
// a counter in TermStat (filtered, in-patient via OP pharmacy, unreadable amount
// or filter error). Nothing disappears without being counted.

import { toPaise } from './money';
import { monthOfIso } from './dates';
import {
  ATTRIBUTION_SOURCE_ID,
  FIELD_KEYS,
  FIELD_KINDS,
  UNATTRIBUTED_DOCTOR_ID,
  type FactRow,
  type FieldKey,
  type MeasureCode,
  type RuleFlags,
  type RuleTerm,
  type SourceId,
} from './types';
import type { RulesFile } from './schemas';
import { UNATTRIBUTED, type Attribution, type ConsultationIndex } from './attribution';
import type { DoctorMatcher, GroupResolver } from './doctors';
import { addCounted, emptyCounted, type RowExample, type TermStat, type UnmatchedDoctor } from './runTypes';
import { compileFormula, describeFormulaError, recordContext, toBool, type CompiledFormula, type FormulaContext, type Value } from '@/formula';
import type { MappedRow, MappedSheet } from '@/excel/mapSource';

const FIELD_KEY_SET: ReadonlySet<string> = new Set(FIELD_KEYS);

// ---------------------------------------------------------------------------
// Which fields the rules need
// ---------------------------------------------------------------------------

/** Field keys a formula refers to (`[grossAmount] - [concession]`); [] if it does not parse. */
export function fieldsInFormula(formula: string | null): FieldKey[] {
  if (!formula) return [];
  try {
    return compileFormula(formula).columns.filter((c): c is FieldKey => FIELD_KEY_SET.has(c));
  } catch {
    return [];
  }
}

/** True when the term applies with these flag settings. */
export function termIsActive(term: RuleTerm, flags: RuleFlags): boolean {
  return term.onlyIf === undefined || flags[term.onlyIf.flag] === term.onlyIf.is;
}

/** Fields the term's value reads (not its filter). */
function valueFields(term: RuleTerm): FieldKey[] {
  if (term.value.type === 'field') return [term.value.field];
  if (term.value.type === 'formula') return fieldsInFormula(term.value.formula);
  return [];
}

/** Fields of a rule term, besides the ones every fact needs. */
function termFields(term: RuleTerm): FieldKey[] {
  return [...fieldsInFormula(term.filter), ...valueFields(term)];
}

/**
 * The fields the active rules need from a source. A source no rule uses needs
 * nothing. The attribution source (OP consultations) is needed whenever OP
 * pharmacy is attributed to doctors, even if no measure reads it directly.
 */
export function requiredFields(rules: RulesFile, sourceId: SourceId): Set<FieldKey> {
  const needed = new Set<FieldKey>();
  const add = (...fields: FieldKey[]) => fields.forEach((f) => needed.add(f));
  let usesAttribution = false;

  for (const rule of rules.rules) {
    if (rule.kind !== 'source') continue;
    for (const term of rule.terms) {
      if (!termIsActive(term, rules.flags)) continue;
      if (term.attribution === 'pharmacyByUmrno') usesAttribution = true;
      if (term.sourceId !== sourceId) continue;
      add('ref', 'txnDate', 'sponsor', ...termFields(term));
      if (term.attribution === 'sourceDoctor') add('doctor', 'department');
      else add('umrno');
    }
  }
  if (usesAttribution && sourceId === ATTRIBUTION_SOURCE_ID) add('ref', 'txnDate', 'umrno', 'doctor', 'department');
  return needed;
}

// ---------------------------------------------------------------------------
// Applying the rules
// ---------------------------------------------------------------------------

export type SourceRows = { sourceId: SourceId; fileName: string; mapped: MappedSheet };

export type RuleEnv = {
  /** 'YYYY-MM'. */
  month: string;
  rules: RulesFile;
  /** Sources that were read successfully. */
  sources: ReadonlyMap<SourceId, SourceRows>;
  doctors: DoctorMatcher;
  departments: GroupResolver;
  sponsors: GroupResolver;
  /** Consultations for pharmacy attribution; null when that source could not be read. */
  consultations: ConsultationIndex | null;
};

export type RuleOutput = {
  facts: FactRow[];
  terms: TermStat[];
  unmatchedDoctors: UnmatchedDoctor[];
  /** Rule formulas that could not be read, or that refer to unknown fields. */
  ruleProblems: string[];
};

type CompiledTerm = { value: CompiledFormula | null; filter: CompiledFormula | null };

/** Row values as a formula context: amounts in rupees, blanks as null, only mapped fields present. */
function toContext(row: MappedRow): FormulaContext {
  const values: Record<string, Value> = {};
  for (const [key, v] of Object.entries(row.values) as [FieldKey, string | number | null][]) {
    values[key] = typeof v === 'number' && FIELD_KINDS[key] === 'money' ? v / 100 : v;
  }
  return recordContext(values);
}

function example(src: SourceRows, row: MappedRow, detail?: string): RowExample {
  const ref = row.values.ref;
  return { sourceFile: src.fileName, sourceRow: row.row, ref: typeof ref === 'string' ? ref : null, ...(detail ? { detail } : {}) };
}

const asText = (v: string | number | null | undefined): string | null => (typeof v === 'string' ? v : null);

class RuleRun {
  readonly facts: FactRow[] = [];
  readonly terms: TermStat[] = [];
  readonly ruleProblems: string[] = [];
  private readonly unmatched = new Map<string, UnmatchedDoctor & { seen: Set<string> }>();

  constructor(private readonly env: RuleEnv) {}

  run(): RuleOutput {
    const { rules } = this.env;
    for (const rule of rules.rules) {
      if (rule.kind !== 'source') continue;
      rule.terms.forEach((term, termIndex) => {
        if (!termIsActive(term, rules.flags)) return;
        const src = this.env.sources.get(term.sourceId);
        if (src) this.applyTerm(rule.measure, termIndex, term, src);
      });
    }
    const unmatchedDoctors = [...this.unmatched.values()]
      .map(({ seen: _seen, ...u }) => u)
      .sort((a, b) => b.rows - a.rows || a.raw.localeCompare(b.raw));
    return { facts: this.facts, terms: this.terms, unmatchedDoctors, ruleProblems: this.ruleProblems };
  }

  private compile(measure: MeasureCode, term: RuleTerm): CompiledTerm | null {
    const compileOne = (text: string | null, what: string): CompiledFormula | null | 'bad' => {
      if (text === null) return null;
      try {
        const f = compileFormula(text);
        const unknown = f.columns.filter((c) => !FIELD_KEY_SET.has(c));
        if (unknown.length > 0) {
          this.ruleProblems.push(`${measure}: the ${what} uses ${unknown.map((c) => `[${c}]`).join(', ')}, which is not a known field.`);
          return 'bad';
        }
        return f;
      } catch (err) {
        this.ruleProblems.push(`${measure}: the ${what} is not a valid formula: ${describeFormulaError(err)}`);
        return 'bad';
      }
    };
    const filter = compileOne(term.filter, 'filter');
    const value = term.value.type === 'formula' ? compileOne(term.value.formula, 'value formula') : null;
    return filter === 'bad' || value === 'bad' ? null : { filter, value };
  }

  private applyTerm(measure: MeasureCode, termIndex: number, term: RuleTerm, src: SourceRows): void {
    const compiled = this.compile(measure, term);
    if (!compiled) return;

    const stat: TermStat = {
      sourceId: term.sourceId,
      measure,
      termIndex,
      sign: term.sign,
      rowsConsidered: 0,
      facts: 0,
      sumPaise: 0,
      filtered: 0,
      ipViaOp: { ...emptyCounted(), amountPaise: 0 },
      filterError: emptyCounted(),
      badAmount: emptyCounted(),
      outsideMonth: emptyCounted(),
      noDate: emptyCounted(),
    };
    this.terms.push(stat);
    // Fields the term reads, in its value or its filter: an unreadable amount in any of them
    // would change the result, so such a row is counted and left out, never guessed at.
    const reads = new Set<FieldKey>([...valueFields(term), ...fieldsInFormula(term.filter)]);
    const pharmacy = term.attribution === 'pharmacyByUmrno';

    for (const row of src.mapped.rows) {
      stat.rowsConsidered++;
      const ctx = toContext(row);

      const amount = this.amountOf(term, compiled, row, ctx, reads);
      if (pharmacy && asText(row.values.admissionNo) !== null) {
        // An in-patient who bought at the OP counter: not OP pharmacy.
        stat.ipViaOp.amountPaise += amount.ok ? amount.paise * term.sign : 0;
        addCounted(stat.ipViaOp, example(src, row));
        continue;
      }

      if (compiled.filter) {
        try {
          if (!toBool(compiled.filter.evaluate(ctx))) {
            stat.filtered++;
            continue;
          }
        } catch (err) {
          addCounted(stat.filterError, example(src, row, describeFormulaError(err)));
          continue;
        }
      }
      if (!amount.ok) {
        addCounted(stat.badAmount, example(src, row, amount.detail));
        continue;
      }

      const paise = amount.paise === 0 ? 0 : amount.paise * term.sign;
      const date = asText(row.values.txnDate);
      if (date === null) addCounted(stat.noDate, example(src, row));
      else if (monthOfIso(date) !== this.env.month) addCounted(stat.outsideMonth, example(src, row, date));

      this.facts.push(this.makeFact(measure, term, src, row, paise, date));
      stat.facts++;
      stat.sumPaise += paise;
    }
  }

  /** The row's amount in integer paise, or why it cannot be read. */
  private amountOf(
    term: RuleTerm,
    compiled: CompiledTerm,
    row: MappedRow,
    ctx: FormulaContext,
    reads: ReadonlySet<FieldKey>,
  ): { ok: true; paise: number } | { ok: false; detail: string } {
    const bad = row.issues.find((i) => i.kind !== 'badDate' && reads.has(i.field as FieldKey));
    if (bad) return { ok: false, detail: bad.message };
    if (term.value.type === 'count') return { ok: true, paise: 1 };

    if (term.value.type === 'field') {
      const v = row.values[term.value.field];
      return { ok: true, paise: typeof v === 'number' ? v : 0 }; // blank = 0
    }
    try {
      const result = (compiled.value as CompiledFormula).evaluate(ctx);
      const paise = typeof result === 'number' ? toPaise(result) : result === null ? 0 : null;
      return paise === null ? { ok: false, detail: 'The value formula did not give a number' } : { ok: true, paise };
    } catch (err) {
      return { ok: false, detail: describeFormulaError(err) };
    }
  }

  private makeFact(measure: MeasureCode, term: RuleTerm, src: SourceRows, row: MappedRow, paise: number, date: string | null): FactRow {
    const { departments, sponsors } = this.env;
    const base = {
      month: this.env.month,
      measure,
      amountPaise: paise,
      sponsor: asText(row.values.sponsor) === null ? null : sponsors.resolve(asText(row.values.sponsor) as string).name,
      sourceId: term.sourceId,
      sourceFile: src.fileName,
      sourceRow: row.row,
      ref: asText(row.values.ref),
      umrno: asText(row.values.umrno),
      txnDate: date,
    };

    if (term.attribution === 'sourceDoctor') {
      const dept = asText(row.values.department);
      return {
        ...base,
        doctorId: this.resolveDoctor(asText(row.values.doctor), term.sourceId, row.row),
        departmentId: dept === null ? null : departments.resolve(dept).key,
      };
    }

    const a: Attribution = this.env.consultations ? this.env.consultations.lookup(base.umrno, date) : UNATTRIBUTED;
    const dept = a.department;
    return {
      ...base,
      doctorId: a.status === 'Unattributed' ? UNATTRIBUTED_DOCTOR_ID : this.resolveDoctor(a.doctor, ATTRIBUTION_SOURCE_ID, row.row),
      departmentId: dept === null ? null : departments.resolve(dept).key,
      attributionMethod: a.method,
      attributionStatus: a.status,
    };
  }

  /** Doctor id from the master; an unknown name is recorded for Checks and never created. */
  private resolveDoctor(raw: string | null, sourceId: SourceId, row: number): string | null {
    const name = raw?.trim() || null;
    const match = name === null ? null : this.env.doctors.match(name);
    if (match?.status === 'matched') return match.doctor.id;

    const key = name ?? '(blank doctor name)';
    let entry = this.unmatched.get(key);
    if (!entry) {
      entry = { raw: key, rows: 0, sources: [], ambiguous: match?.status === 'ambiguous', seen: new Set() };
      this.unmatched.set(key, entry);
    }
    const seenKey = `${sourceId}:${row}`; // one source row can feed several measures
    if (!entry.seen.has(seenKey)) {
      entry.seen.add(seenKey);
      entry.rows++;
      if (!entry.sources.includes(sourceId)) entry.sources.push(sourceId);
    }
    return null;
  }
}

/** Apply every active rule term to the mapped rows and return the fact rows and what happened to each row. */
export function applyRules(env: RuleEnv): RuleOutput {
  return new RuleRun(env).run();
}
