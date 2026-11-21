import { describe, expect, it } from 'vitest';
import { monthOfIso, parseDateText, toIsoDate } from '@/core/dates';

describe('IST dates', () => {
  it('reads an Excel date at IST midnight as the IST day, not the UTC day', () => {
    expect(toIsoDate(new Date('2026-10-11T18:30:00Z'))).toBe('2026-10-12');
    expect(toIsoDate(new Date('2026-10-12T18:29:59Z'))).toBe('2026-10-12');
  });
  it('crosses month and year ends in IST', () => {
    expect(toIsoDate(new Date('2026-10-31T18:30:00Z'))).toBe('2026-11-01');
    expect(toIsoDate(new Date('2026-12-31T20:00:00Z'))).toBe('2027-01-01');
  });
  it('parses the HIS text format DD-MON-YYYY', () => {
    expect(parseDateText('02-OCT-2026')).toBe('2026-10-02');
    expect(parseDateText(' 2-oct-2026 ')).toBe('2026-10-02');
    expect(parseDateText('15-October-2026')).toBe('2026-10-15');
  });
  it('parses ISO and day-first numeric dates', () => {
    expect(parseDateText('2026-10-02')).toBe('2026-10-02');
    expect(parseDateText('2026-10-02T00:00:00Z')).toBe('2026-10-02');
    expect(parseDateText('02/10/2026')).toBe('2026-10-02');
    expect(parseDateText('02-10-2026')).toBe('2026-10-02');
  });
  it('rejects impossible and unreadable dates', () => {
    expect(parseDateText('31-NOV-2026')).toBeNull();
    expect(parseDateText('30-FEB-2026')).toBeNull();
    expect(parseDateText('hello')).toBeNull();
    expect(parseDateText('')).toBeNull();
    expect(toIsoDate(new Date('invalid'))).toBeNull();
    expect(toIsoDate(42)).toBeNull();
    expect(toIsoDate(null)).toBeNull();
  });
  it('gives the month', () => {
    expect(monthOfIso('2026-10-12')).toBe('2026-10');
  });
});
