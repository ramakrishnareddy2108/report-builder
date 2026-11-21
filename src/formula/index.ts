// Formula language: tokenizer -> parser -> AST -> evaluator. Never eval or Function.
//
//   const f = compileFormula('IF([Amount] > 0, [Amount], 0)');
//   f.columns            // ['Amount']  (what the sheet must have)
//   f.evaluate(ctx)      // a Value, or throws FormulaError

import { evaluate } from './evaluator';
import { FUNCTIONS } from './functions';
import { parse } from './parser';
import { FormulaError, FormulaSyntaxError, type FormulaContext, type Node, type Value } from './types';

export { toBool } from './coerce';
export { ColumnIndex, recordContext } from './context';
export { FormulaError, FormulaSyntaxError } from './types';
export type { FormulaContext, FormulaParams, Value } from './types';

export type CompiledFormula = {
  text: string;
  /** Distinct column names and letters the formula refers to, in order of first use. */
  columns: string[];
  evaluate(ctx: FormulaContext): Value;
};

function checkCalls(node: Node, columns: Set<string>): void {
  switch (node.type) {
    case 'ref':
      columns.add(node.name);
      return;
    case 'unary':
    case 'percent':
      return checkCalls(node.arg, columns);
    case 'binary':
      checkCalls(node.left, columns);
      return checkCalls(node.right, columns);
    case 'call': {
      const def = FUNCTIONS[node.name];
      if (!def) throw new FormulaSyntaxError(`Unknown function ${node.name}`, node.pos);
      const n = node.args.length;
      if (n < def.min || n > def.max) {
        const wanted = def.min === def.max ? `${def.min}` : def.max === Infinity ? `at least ${def.min}` : `${def.min} to ${def.max}`;
        throw new FormulaSyntaxError(`${node.name} needs ${wanted} argument${def.max === 1 ? '' : 's'}, but has ${n}`, node.pos);
      }
      node.args.forEach((a) => checkCalls(a, columns));
      return;
    }
    default:
      return;
  }
}

/** Parse and check a formula once; evaluate it many times. Throws FormulaSyntaxError. */
export function compileFormula(text: string): CompiledFormula {
  const ast = parse(text);
  const columns = new Set<string>();
  checkCalls(ast, columns);
  return { text, columns: [...columns], evaluate: (ctx) => evaluate(ast, ctx) };
}

export type FormulaValidation =
  | { ok: true; columns: string[] }
  | { ok: false; message: string; /** 0-based character offset */ position: number };

/** For the editor: is the text a valid formula, and which columns does it use? */
export function validateFormula(text: string): FormulaValidation {
  try {
    return { ok: true, columns: compileFormula(text).columns };
  } catch (err) {
    if (err instanceof FormulaSyntaxError) return { ok: false, message: err.message, position: err.position };
    throw err;
  }
}

/** Compile and evaluate in one go (tests, one-off use). */
export function evaluateFormula(text: string, ctx: FormulaContext): Value {
  return compileFormula(text).evaluate(ctx);
}

/** Plain-language text for any formula problem. */
export function describeFormulaError(err: unknown): string {
  if (err instanceof FormulaSyntaxError) return `${err.message} (at character ${err.position + 1})`;
  if (err instanceof FormulaError) return `${err.message} (${err.code})`;
  return err instanceof Error ? err.message : String(err);
}
