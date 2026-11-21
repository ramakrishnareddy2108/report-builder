// Measure rules: which source fields each measure needs, and (step 9) applying
// the rules to source rows to produce fact rows.

import { compileFormula } from '@/formula';
import type { RulesFile } from './schemas';
import {
  ATTRIBUTION_SOURCE_ID,
  FIELD_KEYS,
  type FieldKey,
  type RuleFlags,
  type RuleTerm,
  type SourceId,
} from './types';

const FIELD_KEY_SET: ReadonlySet<string> = new Set(FIELD_KEYS);

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

/** Fields of a rule term, besides the ones every fact needs. */
function termFields(term: RuleTerm): FieldKey[] {
  const fields: FieldKey[] = [...fieldsInFormula(term.filter)];
  if (term.value.type === 'field') fields.push(term.value.field);
  if (term.value.type === 'formula') fields.push(...fieldsInFormula(term.value.formula));
  return fields;
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
