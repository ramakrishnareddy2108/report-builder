// Tokens -> AST, by recursive descent. Precedence, highest first (as in Excel):
//   unary - +   >   %   >   ^   >   * /   >   + -   >   &   >   = <> < > <= >=
// All binary operators are left-associative, and -2^2 is 4, as in Excel.

import { tokenize, type Token } from './tokenizer';
import { FormulaSyntaxError, type BinaryOp, type Node } from './types';

const LEVELS: readonly (readonly string[])[] = [
  ['=', '<>', '<', '>', '<=', '>='],
  ['&'],
  ['+', '-'],
  ['*', '/'],
  ['^'],
];

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.i] as Token; // the list always ends with eof
  }

  /** The operator text at the cursor, or null if the next token is not an operator. */
  private peekOp(): string | null {
    const t = this.peek();
    return t.kind === 'op' ? t.value : null;
  }

  private next(): Token {
    const t = this.peek();
    if (t.kind !== 'eof') this.i++;
    return t;
  }

  private describe(t: Token): string {
    switch (t.kind) {
      case 'eof': return 'the end of the formula';
      case 'comma': return 'a comma';
      case 'lparen': return '"("';
      case 'rparen': return '")"';
      case 'string': return `the text "${t.value}"`;
      case 'ref': return `[${t.value}]`;
      case 'number': return `the number ${t.value}`;
      default: return `"${t.value}"`;
    }
  }

  parseFormula(): Node {
    if (this.peek().kind === 'eof') throw new FormulaSyntaxError('The formula is empty', 0);
    const node = this.binary(0);
    if (this.peek().kind !== 'eof') {
      const t = this.peek();
      throw new FormulaSyntaxError(
        t.kind === 'rparen' ? 'Unexpected closing parenthesis ")"' : `Unexpected ${this.describe(t)}`,
        t.pos,
      );
    }
    return node;
  }

  private binary(level: number): Node {
    if (level === LEVELS.length) return this.unary();
    const ops = LEVELS[level] as readonly string[];
    let left = this.binary(level + 1);
    for (let op = this.peekOp(); op !== null && ops.includes(op); op = this.peekOp()) {
      const pos = this.next().pos;
      left = { type: 'binary', op: op as BinaryOp, left, right: this.binary(level + 1), pos };
    }
    return left;
  }

  private unary(): Node {
    const t = this.peek();
    if (t.kind === 'op' && (t.value === '-' || t.value === '+')) {
      this.next();
      return { type: 'unary', op: t.value, arg: this.unary(), pos: t.pos };
    }
    let node = this.primary();
    while (this.peekOp() === '%') {
      node = { type: 'percent', arg: node, pos: this.next().pos };
    }
    return node;
  }

  private primary(): Node {
    const t = this.next();
    switch (t.kind) {
      case 'number':
        return { type: 'num', value: t.value, pos: t.pos };
      case 'string':
        return { type: 'str', value: t.value, pos: t.pos };
      case 'ref':
        return { type: 'ref', name: t.value, pos: t.pos };
      case 'lparen': {
        const inner = this.binary(0);
        if (this.peek().kind !== 'rparen') throw new FormulaSyntaxError('Missing closing parenthesis ")"', t.pos);
        this.next();
        return inner;
      }
      case 'name':
        return this.nameOrCall(t);
      default:
        throw new FormulaSyntaxError(`Expected a value but found ${this.describe(t)}`, t.pos);
    }
  }

  private nameOrCall(t: Token & { kind: 'name' }): Node {
    if (this.peek().kind !== 'lparen') {
      const upper = t.value.toUpperCase();
      if (upper === 'TRUE' || upper === 'FALSE') return { type: 'bool', value: upper === 'TRUE', pos: t.pos };
      throw new FormulaSyntaxError(
        `"${t.value}" is not a column or a value. Put column names in square brackets, like [${t.value}]`,
        t.pos,
      );
    }
    const open = this.next();
    const args: Node[] = [];
    if (this.peek().kind === 'rparen') {
      this.next();
    } else {
      for (;;) {
        args.push(this.binary(0));
        if (this.peek().kind === 'comma') {
          this.next();
        } else if (this.peek().kind === 'rparen') {
          this.next();
          break;
        } else {
          throw new FormulaSyntaxError(`Missing closing parenthesis ")" for ${t.value.toUpperCase()}(`, open.pos);
        }
      }
    }
    return { type: 'call', name: t.value.toUpperCase(), args, pos: t.pos };
  }
}

export function parse(text: string): Node {
  return new Parser(tokenize(text)).parseFormula();
}
