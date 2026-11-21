import { describe, expect, it } from 'vitest';
import { evaluateFormula, recordContext } from '@/formula';
import { FUNCTIONS } from '@/formula/functions';
import { EVERYDAY, FORMULA_GROUPS, SAMPLE_PARAMS, SAMPLE_ROW, showValue } from '@/pages/Help/formulaDocs';

const ctx = recordContext(SAMPLE_ROW, SAMPLE_PARAMS);
const run = (formula: string) => showValue(evaluateFormula(formula, ctx));

describe('formula reference on the Help page', () => {
  const documented = FORMULA_GROUPS.flatMap((g) => g.docs);

  it('documents every function of the formula engine, and nothing that does not exist', () => {
    expect(documented.map((d) => d.name).sort()).toEqual(Object.keys(FUNCTIONS).sort());
  });

  it('every example gives exactly the result printed next to it', () => {
    for (const d of documented) expect(run(d.example), `${d.name}: ${d.example}`).toBe(d.result);
  });

  it('every function example starts with its own name, and its syntax line names it', () => {
    for (const d of documented) {
      expect(d.example.toUpperCase(), d.name).toContain(`${d.name}(`);
      expect(d.syntax.startsWith(`${d.name}(`), d.name).toBe(true);
    }
  });

  it('every everyday formula works too', () => {
    for (const e of EVERYDAY) expect(run(e.formula), e.title).toBe(e.result);
  });
});
