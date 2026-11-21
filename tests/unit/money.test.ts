import { describe, expect, it } from 'vitest';
import { formatCompactINR, formatINR, paiseToRupees, parseMoney, sumPaise, toPaise } from '@/core/money';

describe('toPaise — numbers', () => {
  it.each([
    [0, 0],
    [1, 100],
    [123.45, 12345],
    [0.1 + 0.2, 30], // float noise is not carried into paise
    [1.005, 101], // stored as 1.00499999…; Excel shows 1.01
    [2.675, 268],
    [0.125, 13], // half away from zero
    [0.124, 12],
    [-0.125, -13],
    [-1.005, -101],
    [1234567.891, 123456789],
    [-0, 0],
  ])('%s → %s', (input, expected) => {
    const result = toPaise(input);
    expect(result).toBe(expected);
    expect(Object.is(result, -0)).toBe(false);
  });

  it('rejects non-finite and out-of-range numbers', () => {
    expect(toPaise(Number.NaN)).toBeNull();
    expect(toPaise(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toPaise(Number.MAX_SAFE_INTEGER)).toBeNull();
  });
});

describe('toPaise — text', () => {
  it.each([
    ['123', 12300],
    ['123.4', 12340],
    ['123.45', 12345],
    ['123.455', 12346],
    ['123.454', 12345],
    ['.5', 50],
    ['5.', 500],
    ['007.10', 710],
    ['1,23,456.78', 12345678], // Indian grouping
    ['12,34,56,789', 12345678900],
    ['123,456.78', 12345678], // Western grouping
    ['1,000', 100000],
    ['₹1,23,456.78', 12345678],
    ['₹ 500', 50000],
    ['Rs 500', 50000],
    ['Rs. 1,500/-', 150000],
    ['rs.250', 25000],
    ['INR 99.99', 9999],
    ['  42  ', 4200],
    ['1 234', 123400], // non-breaking space as separator
    ['+10', 1000],
  ])('%j → %s', (input, expected) => {
    expect(toPaise(input)).toBe(expected);
  });

  it.each([
    ['-123.45', -12345],
    ['−50', -5000], // Unicode minus
    ['(123)', -12300],
    ['(1,234.50)', -123450],
    ['₹(500)', -50000],
    ['(₹500)', -50000],
    ['-₹1,000', -100000],
    ['₹-1,000', -100000],
    ['Rs. -25.5', -2550],
    ['-0', 0],
    ['(0.00)', 0],
  ])('negative %j → %s', (input, expected) => {
    const result = toPaise(input);
    expect(result).toBe(expected);
    expect(Object.is(result, -0)).toBe(false);
  });

  it('keeps exact paise for large text amounts', () => {
    expect(toPaise('99,99,99,99,99,999.99')).toBe(999999999999999);
    expect(toPaise('12345678901234')).toBeNull(); // > 13 rupee digits
  });
});

describe('toPaise — blank and junk', () => {
  it.each([null, undefined, '', '   ', ' '])('blank %j → null', (input) => {
    expect(toPaise(input)).toBeNull();
    expect(parseMoney(input)).toEqual({ ok: false, reason: 'blank' });
  });

  it.each([
    'abc',
    '12abc',
    '#N/A',
    '#VALUE!',
    '-',
    '.',
    '₹',
    'Rs.',
    '()',
    '1.2.3',
    '1,2',
    '12,34',
    '1,23,4567',
    '1e5',
    '--5',
    '-(5)',
    '(5',
    '5)',
    '12-',
    '0x10',
    'Infinity',
  ])('junk %j → null', (input) => {
    expect(toPaise(input)).toBeNull();
    expect(parseMoney(input)).toEqual({ ok: false, reason: 'invalid' });
  });

  it.each([true, false, new Date(2026, 9, 1), {}, [], 10n])('non-money type %s → null', (input) => {
    expect(toPaise(input)).toBeNull();
    expect(parseMoney(input)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('formatINR', () => {
  it.each([
    [0, '₹0.00'],
    [5, '₹0.05'],
    [50, '₹0.50'],
    [100000, '₹1,000.00'],
    [10000000, '₹1,00,000.00'],
    [12345678, '₹1,23,456.78'],
    [1234567890, '₹1,23,45,678.90'],
    [-50, '-₹0.50'],
    [-12345678, '-₹1,23,456.78'],
  ])('%s → %s', (paise, expected) => {
    expect(formatINR(paise)).toBe(expected);
  });

  it('can omit the symbol', () => {
    expect(formatINR(12345678, { symbol: false })).toBe('1,23,456.78');
    expect(formatINR(-100, { symbol: false })).toBe('-1.00');
  });

  it('round-trips with toPaise', () => {
    for (const p of [0, 1, 99, 12345678, -987654321]) {
      expect(toPaise(formatINR(p))).toBe(p);
    }
  });

  it('refuses non-integer paise', () => {
    expect(() => formatINR(1.5)).toThrow(TypeError);
    expect(() => formatINR(Number.NaN)).toThrow(TypeError);
  });
});

describe('sumPaise', () => {
  it('sums integer paise exactly', () => {
    expect(sumPaise([])).toBe(0);
    expect(sumPaise([10, 20, -5])).toBe(25);
    expect(sumPaise(new Set([1, 2, 3]))).toBe(6);
    expect(Object.is(sumPaise([5, -5]), -0)).toBe(false);
  });

  it('throws on floats so they are never summed', () => {
    expect(() => sumPaise([10, 0.1])).toThrow(TypeError);
    expect(() => sumPaise([Number.NaN])).toThrow(TypeError);
  });

  it('throws when the total overflows', () => {
    expect(() => sumPaise([Number.MAX_SAFE_INTEGER, 1])).toThrow(TypeError);
  });
});

describe('paiseToRupees', () => {
  it('converts for export', () => {
    expect(paiseToRupees(12345)).toBe(123.45);
    expect(paiseToRupees(-1)).toBe(-0.01);
    expect(() => paiseToRupees(0.5)).toThrow(TypeError);
  });
});

describe('formatCompactINR', () => {
  it.each([
    [1250000000, '₹1.25 Cr'],
    [45000000, '₹4.5 L'],
    [1234500, '₹12,345'],
    [-45000000, '-₹4.5 L'],
    [0, '₹0'],
    [10000000000, '₹10 Cr'],
  ])('%i paise -> %s', (paise, text) => expect(formatCompactINR(paise)).toBe(text));
  it('refuses a fraction of a paisa', () => expect(() => formatCompactINR(1.5)).toThrow());
});
