// Formula text -> tokens. Positions are offsets into the original text.

import { FormulaSyntaxError } from './types';

export type Token =
  | { kind: 'number'; value: number; pos: number }
  | { kind: 'string'; value: string; pos: number }
  | { kind: 'ref'; value: string; pos: number }
  | { kind: 'name'; value: string; pos: number }
  | { kind: 'op'; value: string; pos: number }
  | { kind: 'lparen' | 'rparen' | 'comma' | 'eof'; pos: number };

const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;
const NAME = /^[A-Za-z_][A-Za-z0-9_.]*/;
const TWO_CHAR_OPS = new Set(['<>', '<=', '>=']);
const ONE_CHAR_OPS = new Set(['+', '-', '*', '/', '^', '&', '=', '<', '>', '%']);

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  // A leading "=" is optional, as in a spreadsheet cell.
  while (text[i] === ' ' || text[i] === '\t') i++;
  if (text[i] === '=') i++;

  while (i < text.length) {
    const ch = text[i] as string;
    const rest = text.slice(i);

    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '"') {
      let value = '';
      let j = i + 1;
      for (;;) {
        if (j >= text.length) throw new FormulaSyntaxError('Text starting here is missing its closing quote (")', i);
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            value += '"'; // "" is a quote inside text
            j += 2;
            continue;
          }
          break;
        }
        value += text[j];
        j++;
      }
      tokens.push({ kind: 'string', value, pos: i });
      i = j + 1;
    } else if (ch === '[') {
      const end = text.indexOf(']', i + 1);
      if (end === -1) throw new FormulaSyntaxError('Column name starting here is missing its closing bracket (])', i);
      const name = text.slice(i + 1, end).trim();
      if (name === '') throw new FormulaSyntaxError('Empty column name: write a name or letter between [ and ]', i);
      tokens.push({ kind: 'ref', value: name, pos: i });
      i = end + 1;
    } else if (ch === ']') {
      throw new FormulaSyntaxError('Unexpected closing bracket (])', i);
    } else if (/[\d.]/.test(ch)) {
      const m = NUMBER.exec(rest);
      if (!m) throw new FormulaSyntaxError(`"${ch}" is not a valid number`, i);
      tokens.push({ kind: 'number', value: Number(m[0]), pos: i });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = NAME.exec(rest) as RegExpExecArray;
      tokens.push({ kind: 'name', value: m[0], pos: i });
      i += m[0].length;
    } else if (ch === '(') {
      tokens.push({ kind: 'lparen', pos: i++ });
    } else if (ch === ')') {
      tokens.push({ kind: 'rparen', pos: i++ });
    } else if (ch === ',' || ch === ';') {
      tokens.push({ kind: 'comma', pos: i++ });
    } else if (TWO_CHAR_OPS.has(text.slice(i, i + 2))) {
      tokens.push({ kind: 'op', value: text.slice(i, i + 2), pos: i });
      i += 2;
    } else if (ONE_CHAR_OPS.has(ch)) {
      tokens.push({ kind: 'op', value: ch, pos: i++ });
    } else {
      throw new FormulaSyntaxError(`Unexpected character "${ch}"`, i);
    }
  }
  tokens.push({ kind: 'eof', pos: text.length });
  return tokens;
}
