// Pharmacy has no doctor column, so each OP pharmacy row is attributed to a
// doctor through the patient's OP consultations in the month. In order:
//
// 1. Admission no. filled   -> an in-patient: not OP pharmacy (the caller counts it apart).
// 2. UMRNO has exactly one consultation -> that doctor, status Matched.
// 3. Several consultations  -> the latest on or before the bill date, else the
//                              earliest after it; status Fallback.
// 4. No consultation        -> "Pharmacy – Unattributed", status Unattributed.

import type { MappedRow } from '@/excel/mapSource';
import type { AttributionStatus } from './types';

export type Consultation = {
  /** Excel row in the consultations file. */
  row: number;
  /** ISO date, or null when unreadable. */
  date: string | null;
  doctor: string | null;
  department: string | null;
};

export type Attribution = {
  status: AttributionStatus;
  /** How the doctor was found, stored on the fact row. */
  method: string;
  /** Raw doctor / department names of the chosen consultation (null when Unattributed). */
  doctor: string | null;
  department: string | null;
};

export const UNATTRIBUTED: Attribution = { status: 'Unattributed', method: 'no-consultation', doctor: null, department: null };

/** Consultations of the month by UMRNO. */
export class ConsultationIndex {
  private readonly byUmr = new Map<string, Consultation[]>();

  constructor(rows: readonly MappedRow[]) {
    for (const r of rows) {
      const umr = r.values.umrno;
      if (typeof umr !== 'string') continue;
      const list = this.byUmr.get(umr) ?? [];
      list.push({
        row: r.row,
        date: typeof r.values.txnDate === 'string' ? r.values.txnDate : null,
        doctor: typeof r.values.doctor === 'string' ? r.values.doctor : null,
        department: typeof r.values.department === 'string' ? r.values.department : null,
      });
      this.byUmr.set(umr, list);
    }
    // Oldest first; undated last; Excel row order breaks ties.
    for (const list of this.byUmr.values()) {
      list.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.row - b.row);
    }
  }

  lookup(umrno: string | null, billDate: string | null): Attribution {
    const list = umrno === null ? undefined : this.byUmr.get(umrno);
    if (!list || list.length === 0) return UNATTRIBUTED;

    if (list.length === 1) return pick('Matched', 'single-consultation', list[0] as Consultation);

    if (billDate !== null) {
      const onOrBefore = list.filter((c) => c.date !== null && c.date <= billDate);
      const latest = onOrBefore.at(-1);
      if (latest) return pick('Fallback', 'latest-consultation-before-bill', latest);
      const after = list.find((c) => c.date !== null && c.date > billDate);
      if (after) return pick('Fallback', 'earliest-consultation-after-bill', after);
    }
    return pick('Fallback', billDate === null ? 'first-consultation-no-bill-date' : 'first-consultation-no-date', list[0] as Consultation);
  }
}

function pick(status: AttributionStatus, method: string, c: Consultation): Attribution {
  return { status, method, doctor: c.doctor, department: c.department };
}
