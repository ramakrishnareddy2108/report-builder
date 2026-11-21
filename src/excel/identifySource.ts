// Work out which of the 8 HIS sources a dropped file is.
//
// 1. File name against each source's namePattern (month names, years, dates
//    and other numbers in the file name are ignored).
// 2. Otherwise, the source whose expected headers best overlap the file's.
// The result carries a confidence from 0 to 1; the UI asks the user to pick
// when it is low.

import { SOURCE_LABELS, type SourceId, type SourceMapping } from '@/core/types';
import { cleanHeaderText } from './detectHeader';

export type SourceSignature = {
  sourceId: SourceId;
  namePattern: string;
  /** Preferred sheet name, when known. */
  sheet: string | null;
  /** Header names this source is expected to have. */
  headers: string[];
};

/** Built from the key columns in CLAUDE.md (October 2026 exports). */
export const DEFAULT_SOURCE_SIGNATURES: readonly SourceSignature[] = [
  {
    sourceId: 'ipAdmissions',
    namePattern: 'IP Admissions report',
    sheet: 'Sheet1',
    headers: ['ADMISSIONNO', 'ADMISSIONDT', 'DOCTORNAME', 'DEPARTMENTNAME', 'ORGANIZATIONNAME'],
  },
  {
    sourceId: 'ipDischarge',
    namePattern: 'IP Discharge Report',
    sheet: 'Sheet1',
    headers: ['ADMISSIONNO', 'DISCHARGEDT', 'DOCTORNAME', 'DEPARTMENTNAME', 'ORGANIZATIONNAME', 'GROSSAMOUNT', 'CONCESSION'],
  },
  {
    sourceId: 'ipGeneralBill',
    namePattern: 'IP General Bill Breakup',
    sheet: 'Sheet1',
    headers: ['BILLNO', 'BILLDT', 'ADMISSIONNO', 'GROSSAMOUNT', 'CONCESSION', 'BILLSTATUS', 'DOCTORNAME', 'DEPARTMENTNAME', 'ORGNAME'],
  },
  {
    sourceId: 'ipBillBreakups',
    namePattern: 'IP Bill Breakups',
    sheet: 'Sheet1',
    headers: ['BILLNO', 'BILLDT', 'ADMISSIONNO', 'DOCTORNAME', 'DEPARTMENTNAME', 'ORGANIZATIONNAME', 'GROSS', 'PHARMACY', 'PHARPURCAMOUNT', 'BILLTYPE'],
  },
  {
    sourceId: 'opBilling',
    namePattern: 'OP Billing Report',
    sheet: 'Sheet1',
    headers: ['BILLNO', 'BILLDT', 'UMRNO', 'DOCTORNAME', 'DEPARTMENTNAME', 'NETAMOUNT', 'BILLTYPE', 'ORGANIZATIONNAME'],
  },
  {
    sourceId: 'opConsultations',
    namePattern: 'OP Consultations Report',
    sheet: 'Sheet1',
    headers: ['CONSULTATIONNO', 'CONSULTATIONDT', 'UMRNO', 'DOCTORNAME', 'DEPARTMENTNAME', 'Net Amount', 'ORGANIZATIONNAME'],
  },
  {
    sourceId: 'opPharmacySales',
    namePattern: 'gst op pharmacy sales',
    sheet: 'OP pharmacy sales data',
    headers: ['BILLNO', 'BILLDT', 'UMRNO', 'ADMNNO', 'ORGANIZATIONNAME', 'SALEVALUE_BEFORETAX', 'PURCHASEVALUE_BEFORE_TAX'],
  },
  {
    sourceId: 'opReturns',
    namePattern: 'op returns report',
    sheet: 'Sheet1',
    headers: ['BILLNO', 'BILLDT', 'ORIGINAL_BILLNO', 'UMRNO', 'ADMISSIONNO', 'ORGANIZATIONNAME', 'SALEVALUE_BEFORETAX'],
  },
];

/** A signature from a saved mapping: the header names its column fields point to. */
export function signatureFromMapping(m: SourceMapping): SourceSignature {
  const headers: string[] = [];
  for (const f of Object.values(m.fields)) {
    if (f?.type === 'column' && f.by !== 'letter' && !headers.includes(f.value)) headers.push(f.value);
  }
  return { sourceId: m.sourceId, namePattern: m.namePattern, sheet: m.sheet, headers };
}

// ---------------------------------------------------------------------------
// File name matching
// ---------------------------------------------------------------------------

const MONTH_WORDS = new Set([
  'jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april', 'may',
  'jun', 'june', 'jul', 'july', 'aug', 'august', 'sep', 'sept', 'september',
  'oct', 'october', 'nov', 'november', 'dec', 'december',
]);

function stem(token: string): string {
  return token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token;
}

/**
 * Words of a file name or pattern, lower-case, without the extension, month
 * names or numbers (years, dates, "(1)" copies). Letters and digits that run
 * together are split, so "Oct2026" goes away completely. Plural "s" is dropped.
 */
export function nameTokens(name: string): string[] {
  const base = name.replace(/\.(xlsx|xlsm|xls|xlsb|csv)$/i, '').toLowerCase();
  const tokens = base.match(/[a-z]+|\d+/g) ?? [];
  return tokens.filter((t) => !/^\d+$/.test(t) && !MONTH_WORDS.has(t)).map(stem);
}

function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** 1 when the file name is exactly the pattern, 0.9 when it contains it, else 0. */
export function matchNamePattern(fileName: string, pattern: string): number {
  const file = nameTokens(fileName);
  const pat = nameTokens(pattern);
  if (pat.length === 0) return 0;
  if (file.length === pat.length && containsRun(file, pat)) return 1;
  return containsRun(file, pat) ? 0.9 : 0;
}

// ---------------------------------------------------------------------------
// Identification
// ---------------------------------------------------------------------------

/** Headers found in one sheet of the file (null header row = no text found). */
export type SheetHeaders = { sheet: string; headerRow: number | null; headers: string[] };

export type SourceCandidate = {
  sourceId: SourceId;
  /** File-name score: 1 exact, 0.9 contains, 0 no match. */
  nameScore: number;
  /** Share of the expected headers found in the best sheet (null when the source lists none). */
  headerScore: number | null;
  /** How many expected headers were found. */
  headersFound: number;
  missingHeaders: string[];
  /** The sheet that fits this source best. */
  sheet: string | null;
};

export type SourceIdentification = {
  sourceId: SourceId | null;
  sheet: string | null;
  /** 0..1; below 0.6 the user should confirm the source. */
  confidence: number;
  method: 'name' | 'headers' | 'none';
  /** Plain-language explanation. */
  reason: string;
  /** Every known source, best first. */
  candidates: SourceCandidate[];
};

const headerKey = (h: string) => cleanHeaderText(h).toUpperCase();

function scoreHeaders(sig: SourceSignature, sheets: readonly SheetHeaders[]): Omit<SourceCandidate, 'sourceId' | 'nameScore'> {
  const expected = [...new Set(sig.headers.map(headerKey))];
  const preferred = sheets.find((s) => s.sheet === sig.sheet)?.sheet ?? null;
  if (expected.length === 0) {
    return { headerScore: null, headersFound: 0, missingHeaders: [], sheet: preferred ?? sheets[0]?.sheet ?? null };
  }
  let best: { sheet: string; found: string[] } | null = null;
  for (const s of sheets) {
    const have = new Set(s.headers.map(headerKey));
    const found = expected.filter((h) => have.has(h));
    // More headers wins; on a tie the source's own sheet name wins, then the earlier sheet.
    if (!best || found.length > best.found.length || (found.length === best.found.length && s.sheet === preferred && best.sheet !== preferred)) {
      best = { sheet: s.sheet, found };
    }
  }
  const found = best?.found ?? [];
  const missing = sig.headers.filter((h) => !found.includes(headerKey(h)));
  return {
    headerScore: found.length / expected.length,
    headersFound: found.length,
    missingHeaders: missing,
    sheet: best && found.length > 0 ? best.sheet : preferred,
  };
}

function rankByHeaders(a: SourceCandidate, b: SourceCandidate): number {
  return (b.headerScore ?? -1) - (a.headerScore ?? -1) || b.headersFound - a.headersFound;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const label = (id: SourceId | undefined) => (id ? SOURCE_LABELS[id] : '');

export function identifySource(
  fileName: string,
  sheets: readonly SheetHeaders[],
  signatures: readonly SourceSignature[] = DEFAULT_SOURCE_SIGNATURES,
): SourceIdentification {
  const candidates: SourceCandidate[] = signatures.map((sig) => ({
    sourceId: sig.sourceId,
    nameScore: matchNamePattern(fileName, sig.namePattern),
    ...scoreHeaders(sig, sheets),
  }));
  const patternLength = new Map(signatures.map((s) => [s.sourceId, nameTokens(s.namePattern).length]));
  const byHeaders = [...candidates].sort(rankByHeaders);
  const sorted = [...candidates].sort((a, b) => b.nameScore - a.nameScore || rankByHeaders(a, b));

  // 1. File name. When several patterns match, the longest (most specific) wins;
  //    equal-length matches are settled by headers.
  const named = candidates
    .filter((c) => c.nameScore > 0)
    .sort(
      (a, b) =>
        (patternLength.get(b.sourceId) ?? 0) - (patternLength.get(a.sourceId) ?? 0) ||
        b.nameScore - a.nameScore ||
        rankByHeaders(a, b),
    );
  const top = named[0];
  if (top) {
    const tiedName = named.length > 1 && patternLength.get(named[1]!.sourceId) === patternLength.get(top.sourceId);
    const score = top.headerScore;
    let confidence: number;
    let reason: string;
    if (score === null) {
      confidence = 0.85;
      reason = 'The file name matches; no expected columns are set up to double-check it.';
    } else if (score >= 0.8) {
      confidence = top.nameScore === 1 ? 1 : 0.95;
      reason = `The file name matches and ${top.headersFound} of ${top.headersFound + top.missingHeaders.length} expected columns were found.`;
    } else {
      // Another source whose columns fit clearly better means the name is misleading.
      const other = byHeaders.find(
        (c) => c.sourceId !== top.sourceId && (c.headerScore ?? 0) >= 0.8 && (c.headerScore ?? 0) > score,
      );
      if (other) {
        confidence = 0.4;
        reason = `The file name looks like ${label(top.sourceId)}, but its columns look like ${label(other.sourceId)}. Please choose.`;
      } else if (score >= 0.5) {
        confidence = 0.75;
        reason = `The file name matches, but some expected columns are missing: ${top.missingHeaders.join(', ')}.`;
      } else {
        confidence = 0.5;
        reason = `The file name matches, but most expected columns are missing: ${top.missingHeaders.join(', ')}.`;
      }
    }
    if (tiedName) {
      confidence = Math.min(confidence, 0.5);
      reason = `The file name matches more than one source (${named.filter((c) => patternLength.get(c.sourceId) === patternLength.get(top.sourceId)).map((c) => label(c.sourceId)).join(', ')}). Please choose.`;
    }
    return {
      sourceId: top.sourceId,
      sheet: top.sheet,
      confidence: round2(confidence),
      method: 'name',
      reason,
      candidates: sorted,
    };
  }

  // 2. Headers.
  const best = byHeaders[0];
  if (!best || best.headerScore === null || best.headerScore < 0.5) {
    return {
      sourceId: null,
      sheet: null,
      confidence: 0,
      method: 'none',
      reason: 'Neither the file name nor its columns match a known source. Please choose the source.',
      candidates: byHeaders,
    };
  }
  const second = byHeaders[1];
  const secondScore = second?.headerScore ?? 0;
  const clearWinner =
    !second ||
    secondScore <= best.headerScore - 0.15 ||
    best.headersFound - second.headersFound >= 2;
  const confidence = best.headerScore * (clearWinner ? 0.9 : 0.5);
  return {
    sourceId: best.sourceId,
    sheet: best.sheet,
    confidence: round2(confidence),
    method: 'headers',
    reason: clearWinner
      ? `The file name is not recognised; ${pct(best.headerScore)} of the expected columns for ${label(best.sourceId)} were found.`
      : `The file name is not recognised and the columns fit both ${label(best.sourceId)} and ${label(second?.sourceId)}. Please choose.`,
    candidates: byHeaders,
  };
}
