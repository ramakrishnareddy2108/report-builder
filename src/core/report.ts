// The two reports as plain rows: one per doctor (DRR) and one per sponsor.
// The Run page shows them and the Excel output writes them, from the same rows.

import { NONE_KEY, UNMATCHED_KEY, pivot, totalValues, type MeasureValues } from './aggregate';
import { monthLabel } from './dates';
import {
  UNATTRIBUTED_DOCTOR_ID,
  UNATTRIBUTED_DOCTOR_NAME,
  type CostEntry,
  type DoctorMaster,
  type FactRow,
} from './types';

export const UNMATCHED_DOCTOR_NAME = 'Unmatched doctor (see Checks)';
export const NO_SPONSOR_NAME = '(No sponsor)';

export type ReportRow = {
  /** Doctor id, sponsor name or a special key. */
  key: string;
  /** Serial number, from 1. */
  sNo: number;
  /** Doctor or sponsor name as shown. */
  name: string;
  /** DRR only; '' for sponsors and special rows. */
  department: string;
  /** 'YYYY-MM'. */
  month: string;
  monthLabel: string;
  values: MeasureValues;
};

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

/**
 * One row per doctor with any activity or cost. Named doctors come first (A to Z), then
 * "Pharmacy – Unattributed", then doctors that could not be matched. Costs of doctors who are
 * not in the doctor list are left out here (the Checks report them).
 */
export function doctorReport(
  facts: readonly FactRow[],
  costs: readonly CostEntry[],
  doctors: readonly DoctorMaster[],
  month: string,
): ReportRow[] {
  const byId = new Map(doctors.map((d) => [d.id, d]));
  const knownCosts = costs.filter((c) => byId.has(c.doctorId));
  const rows = pivot(facts, 'doctor', { costs: knownCosts }).map((r) => {
    const doctor = byId.get(r.key);
    const name = doctor?.displayName ?? (r.key === UNATTRIBUTED_DOCTOR_ID ? UNATTRIBUTED_DOCTOR_NAME : r.key === UNMATCHED_KEY ? UNMATCHED_DOCTOR_NAME : r.key);
    const order = doctor ? 0 : r.key === UNATTRIBUTED_DOCTOR_ID ? 1 : r.key === UNMATCHED_KEY ? 3 : 2;
    return { order, key: r.key, name, department: doctor?.department ?? '', values: r.values };
  });
  rows.sort((a, b) => a.order - b.order || byName(a, b));
  return rows.map(({ order: _order, ...r }, i) => ({ ...r, sNo: i + 1, month, monthLabel: monthLabel(month) }));
}

/** One row per sponsor (ORGANIZATIONNAME or its group), A to Z, rows with no sponsor last. */
export function sponsorReport(facts: readonly FactRow[], month: string): ReportRow[] {
  const rows = pivot(facts, 'sponsor').map((r) => ({
    order: r.key === NONE_KEY ? 1 : 0,
    key: r.key,
    name: r.key === NONE_KEY ? NO_SPONSOR_NAME : r.key,
    department: '',
    values: r.values,
  }));
  rows.sort((a, b) => a.order - b.order || byName(a, b));
  return rows.map(({ order: _order, ...r }, i) => ({ ...r, sNo: i + 1, month, monthLabel: monthLabel(month) }));
}

/** The totals row under a report. */
export function reportTotals(rows: readonly ReportRow[]): MeasureValues {
  return totalValues(rows);
}
