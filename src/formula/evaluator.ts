// AST -> value. Never uses eval or Function.

import { checkNumber, clean, compareValues, toNumber, toText } from './coerce';
import { FUNCTIONS, type Thunk } from './functions';
import { FormulaError, type BinaryOp, type FormulaContext, type Node, type Value } from './types';

export function evaluate(node: Node, ctx: FormulaContext): Value {
  switch (node.type) {
    case 'num':
    case 'str':
    case 'bool':
      return node.value;

    case 'ref': {
      const v = ctx.getColumn(node.name);
      if (v === undefined) throw new FormulaError('#REF!', `The column [${node.name}] was not found`);
      return v;
    }

    case 'unary': {
      const n = toNumber(evaluate(node.arg, ctx));
      return node.op === '-' ? (n === 0 ? 0 : -n) : n;
    }

    case 'percent':
      return clean(toNumber(evaluate(node.arg, ctx)) / 100);

    case 'binary':
      return binary(node.op, evaluate(node.left, ctx), evaluate(node.right, ctx));

    case 'call': {
      const def = FUNCTIONS[node.name];
      if (!def) throw new FormulaError('#NAME?', `Unknown function ${node.name}`);
      if (def.lazy) return def.fn(node.args.map((a): Thunk => () => evaluate(a, ctx)), ctx);
      return def.fn(node.args.map((a) => evaluate(a, ctx)), ctx);
    }
  }
}

function binary(op: BinaryOp, a: Value, b: Value): Value {
  switch (op) {
    case '+':
      return checkNumber(clean(toNumber(a) + toNumber(b)));
    case '-':
      return checkNumber(clean(toNumber(a) - toNumber(b)));
    case '*':
      return checkNumber(clean(toNumber(a) * toNumber(b)));
    case '/': {
      const d = toNumber(b);
      if (d === 0) throw new FormulaError('#DIV/0!', 'Cannot divide by zero');
      return checkNumber(clean(toNumber(a) / d));
    }
    case '^': {
      const base = toNumber(a);
      const exp = toNumber(b);
      if (base === 0 && exp < 0) throw new FormulaError('#DIV/0!', 'Cannot divide by zero');
      return checkNumber(clean(base ** exp));
    }
    case '&':
      return toText(a) + toText(b);
    case '=':
      return compareValues(a, b) === 0;
    case '<>':
      return compareValues(a, b) !== 0;
    case '<':
      return compareValues(a, b) < 0;
    case '>':
      return compareValues(a, b) > 0;
    case '<=':
      return compareValues(a, b) <= 0;
    case '>=':
      return compareValues(a, b) >= 0;
  }
}
