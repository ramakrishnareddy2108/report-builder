import { describe, expect, it } from 'vitest';
import {
  ColumnIndex,
  FormulaError,
  FormulaSyntaxError,
  compileFormula,
  evaluateFormula,
  recordContext,
  validateFormula,
  type Value,
} from '@/formula';

const ctx = recordContext({
  A: 10,
  B: 4,
  Name: '  dr. kumar ',
  Blank: null,
  Text: 'abc',
  Date: new Date('2026-10-11T18:30:00Z'),
});
const run = (f: string): Value => evaluateFormula(f, ctx);

describe('operators and precedence', () => {
  it.each([
    ['1+2*3', 7],
    ['(1+2)*3', 9],
    ['10-4-3', 3],
    ['2^3^2', 64], // left-associative, as in Excel
    ['-2^2', 4], // unary minus binds tighter than ^, as in Excel
    ['2*-3', -6],
    ['50%', 0.5],
    ['200*10%', 20],
    ['10/4', 2.5],
    ['0.1+0.2', 0.3], // no binary float noise
    ['[A]-[B]*2', 2],
    ['= 1+1', 2], // leading = optional
    ['MAX(1;5;3)', 5], // ; accepted as ,
  ])('%s = %s', (f, expected) => expect(run(f)).toBe(expected));

  it('concatenates with & and converts numbers to text', () => {
    expect(run('"a"&"b"&1.50')).toBe('ab1.5');
    expect(run('[Text]&[Blank]&"!"')).toBe('abc!');
    expect(run('"say ""hi"""')).toBe('say "hi"');
  });

  it('compares numbers numerically and text ignoring case', () => {
    expect(run('[A]>[B]')).toBe(true);
    expect(run('"10">9')).toBe(true); // numeric text vs number
    expect(run('"Abc"="aBC"')).toBe(true);
    expect(run('[Text]<>"ABC"')).toBe(false);
    expect(run('"a"<"B"')).toBe(true);
    expect(run('[Blank]=0')).toBe(true);
    expect(run('[Blank]=""')).toBe(true);
    expect(run('[A]<=10')).toBe(true);
    expect(run('[A]>=11')).toBe(false);
  });
});

describe('blanks and coercion', () => {
  it('treats blank as 0 for numbers and "" for text', () => {
    expect(run('[Blank]+5')).toBe(5);
    expect(run('LEN([Blank])')).toBe(0);
    expect(run('"x"&[Blank]')).toBe('x');
  });
  it('reads numeric text as a number and rejects other text', () => {
    expect(run('"1,200"+1')).toBe(1201);
    expect(() => run('[Text]+1')).toThrow(FormulaError);
  });
  it('TRUE and FALSE are values', () => {
    expect(run('IF(TRUE,1,2)')).toBe(1);
    expect(run('NOT(FALSE)')).toBe(true);
  });
});

describe('errors', () => {
  it('divide by zero throws FormulaError #DIV/0!', () => {
    expect(() => run('1/0')).toThrow(expect.objectContaining({ name: 'FormulaError', code: '#DIV/0!' }));
    expect(() => run('[A]/[Blank]')).toThrow(FormulaError);
    expect(() => run('MOD(5,0)')).toThrow(FormulaError);
  });
  it('IFERROR catches runtime errors', () => {
    expect(run('IFERROR(1/0,-1)')).toBe(-1);
    expect(run('IFERROR([A]/2,-1)')).toBe(5);
    expect(run('IFERROR([Text]+1,"bad")')).toBe('bad');
  });
  it('IFERROR never hides a missing column', () => {
    expect(() => run('IFERROR([Nope],0)')).toThrow(expect.objectContaining({ code: '#REF!' }));
  });
  it('a missing column is an error at run time', () => {
    expect(() => run('[Nope]+1')).toThrow(/\[Nope\] was not found/);
  });
});

describe('lazy functions', () => {
  it('IF only evaluates the branch it takes', () => {
    expect(run('IF(TRUE, 1, 1/0)')).toBe(1);
    expect(run('IF(FALSE, 1/0, 2)')).toBe(2);
    expect(run('IF(FALSE, 1)')).toBe(false);
  });
  it('AND / OR short-circuit', () => {
    expect(run('AND(FALSE, 1/0)')).toBe(false);
    expect(run('OR(TRUE, 1/0)')).toBe(true);
    expect(run('AND([A]>1,[B]>1)')).toBe(true);
    expect(run('OR([A]>100,[B]>100)')).toBe(false);
  });
  it('IFS picks the first true condition and errors when none is', () => {
    expect(run('IFS([A]>100,"big",[A]>5,"mid",TRUE,"small")')).toBe('mid');
    expect(() => run('IFS(FALSE,1)')).toThrow(expect.objectContaining({ code: '#N/A' }));
    expect(run('IFS(TRUE,1,1/0,2)')).toBe(1); // stops at the first true pair
    expect(() => run('IFS(TRUE,1,FALSE)')).toThrow(FormulaError); // a condition without a result
  });
});

describe('maths functions', () => {
  it.each([
    ['ROUND(2.5,0)', 3],
    ['ROUND(-2.5,0)', -3],
    ['ROUND(1.005,2)', 1.01],
    ['ROUND(1234,-2)', 1200],
    ['ROUND(2.567)', 3],
    ['ROUNDUP(2.341,2)', 2.35],
    ['ROUNDDOWN(2.349,2)', 2.34],
    ['ROUNDDOWN(-2.9,0)', -2],
    ['INT(-1.5)', -2],
    ['INT(7.9)', 7],
    ['ABS(-3.2)', 3.2],
    ['MIN(3,1,2)', 1],
    ['MAX(3,1,2)', 3],
    ['SUM(0.1,0.2,[A])', 10.3],
    ['AVERAGE(2,4,9)', 5],
    ['MOD(10,3)', 1],
    ['MOD(-1,3)', 2], // sign follows the divisor
  ])('%s = %s', (f, expected) => expect(run(f)).toBe(expected));
});

describe('text functions', () => {
  it.each([
    ['UPPER("aB")', 'AB'],
    ['LOWER("aB")', 'ab'],
    ['PROPER("dr. a  kumar")', 'Dr. A  Kumar'],
    ['TRIM([Name])', 'dr. kumar'],
    ['LEFT("abcdef",3)', 'abc'],
    ['LEFT("abc")', 'a'],
    ['RIGHT("abcdef",2)', 'ef'],
    ['RIGHT("abc",0)', ''],
    ['MID("abcdef",2,3)', 'bcd'],
    ['LEN("abcd")', 4],
    ['CONCAT("a",1,TRUE)', 'a1TRUE'],
    ['SUBSTITUTE("a-b-c","-","+")', 'a+b+c'],
    ['SUBSTITUTE("a-b-c","-","+",2)', 'a-b+c'],
    ['SEARCH("C","abcd")', 3],
    ['SEARCH("b","abab",3)', 4],
    ['CONTAINS("Corporate.","CORP")', true],
    ['CONTAINS("abc","z")', false],
  ])('%s = %s', (f, expected) => expect(run(f)).toBe(expected));

  it('SEARCH fails when the text is missing', () => {
    expect(() => run('SEARCH("z","abc")')).toThrow(FormulaError);
  });
});

describe('check and date functions', () => {
  it('ISBLANK / ISNUMBER / VALUE', () => {
    expect(run('ISBLANK([Blank])')).toBe(true);
    expect(run('ISBLANK("   ")')).toBe(true);
    expect(run('ISBLANK([A])')).toBe(false);
    expect(run('ISNUMBER([A])')).toBe(true);
    expect(run('ISNUMBER("5")')).toBe(false);
    expect(run('VALUE("1,234.50")')).toBe(1234.5);
    expect(run('VALUE("5%")')).toBe(0.05);
    expect(() => run('VALUE("abc")')).toThrow(FormulaError);
  });
  it('YEAR / MONTH / DAY read dates in IST and date text', () => {
    // 2026-10-11T18:30Z is 12 Oct IST — never slice the UTC string.
    expect(run('DAY([Date])')).toBe(12);
    expect(run('MONTH([Date])')).toBe(10);
    expect(run('YEAR([Date])')).toBe(2026);
    expect(run('DAY("02-OCT-2026")')).toBe(2);
    expect(run('MONTH("2026-11-05")')).toBe(11);
    expect(() => run('YEAR("not a date")')).toThrow(FormulaError);
  });
});

describe('syntax errors', () => {
  it.each([
    ['', /empty/i, 0],
    ['1+', /expected a value/i, 2],
    ['(1+2', /missing closing parenthesis/i, 0],
    ['1+2)', /unexpected closing parenthesis/i, 3],
    ['"abc', /missing its closing quote/i, 0],
    ['[Col', /missing its closing bracket/i, 0],
    ['[]', /empty column name/i, 0],
    ['1 $ 2', /unexpected character/i, 2],
    ['Amount+1', /square brackets/i, 0],
    ['FOO(1)', /unknown function FOO/i, 0],
    ['ROUND()', /needs 1 to 2 arguments/i, 0],
    ['IF(1)', /needs 2 to 3 arguments/i, 0],
    ['NOT(1,2)', /needs 1 argument/i, 0],
    ['SUM(1,2', /missing closing parenthesis/i, 3],
    ['1 2', /unexpected the number 2/i, 2],
  ])('"%s" → %s at %i', (f, message, position) => {
    const v = validateFormula(f);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.message).toMatch(message);
      expect(v.position).toBe(position);
    }
  });
});

describe('validateFormula and compileFormula', () => {
  it('lists the referenced columns once, in order', () => {
    expect(validateFormula('IF([Gross] > 0, [Gross] - [Concession], [AH])')).toEqual({
      ok: true,
      columns: ['Gross', 'Concession', 'AH'],
    });
  });
  it('a compiled formula can be evaluated many times', () => {
    const f = compileFormula('[A]*2');
    expect(f.evaluate(recordContext({ A: 1 }))).toBe(2);
    expect(f.evaluate(recordContext({ A: 5 }))).toBe(10);
  });
  it('never evaluates arbitrary code', () => {
    expect(validateFormula('constructor.constructor("return 1")()').ok).toBe(false);
    expect(validateFormula('process.exit(1)').ok).toBe(false);
    expect(() => compileFormula('1+')).toThrow(FormulaSyntaxError);
  });
});

describe('ColumnIndex', () => {
  const headers = ['BILLNO', 'ADMISSIONDT', 'Net Amount', 'ADMISSIONDT (2)'];
  const index = new ColumnIndex(headers);
  const row = ['B1', '02-OCT-2026', 450, new Date('2026-10-04T00:00:00Z')];

  it('finds columns exactly, then ignoring case, then by letter', () => {
    expect(index.find('Net Amount')).toBe(2);
    expect(index.find('net amount')).toBe(2);
    expect(index.find('C')).toBe(2);
    expect(index.find('d')).toBe(3);
    expect(index.find('Z')).toBeNull();
    expect(index.find('Nope')).toBeNull();
  });
  it('an exact header beats a column letter', () => {
    expect(new ColumnIndex(['x', 'A']).find('A')).toBe(1);
  });
  it('reads a row, including duplicate headers by their unique name', () => {
    const c = index.forRow(row);
    expect(evaluateFormula('[Net Amount] * 2', c)).toBe(900);
    expect(evaluateFormula('[ADMISSIONDT (2)] > [ADMISSIONDT]', c)).toBe(true);
    expect(evaluateFormula('[A]', c)).toBe('B1');
  });
});
