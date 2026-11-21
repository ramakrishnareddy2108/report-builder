import { describe, expect, it } from 'vitest';
import { defaultReportMonth, monthOfIso, parseDateText, previousMonth, toIsoDate } from '@/core/dates';

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

describe('months', () => {
  it('finds the previous month, across a year end', () => {
    expect(previousMonth('2026-11')).toBe('2026-10');
    expect(previousMonth('2026-01')).toBe('2025-12');
  });
  it('defaults to the calendar month before today, in IST', () => {
    expect(defaultReportMonth(new Date('2026-11-21T10:00:00Z'))).toBe('2026-10');
    expect(defaultReportMonth(new Date('2026-01-05T10:00:00Z'))).toBe('2025-12');
    // 30 Nov 20:00 UTC is already 1 Dec in India
    expect(defaultReportMonth(new Date('2026-11-30T20:00:00Z'))).toBe('2026-11');
  });
});
