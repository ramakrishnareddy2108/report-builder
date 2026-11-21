// The made-up month (October 2026) as plain data, shared by the in-memory tests
// and scripts/make-fixtures.ts, which writes it to tests/fixtures/synthetic/.
//
// It covers: 2 doctors + 1 unknown, a patient with 2 consultations, OP pharmacy
// sales and returns (including in-patient lines), an unreadable amount, a bill
// dated outside the month, and a grand-total row. No real patient data.
// Imports use no path aliases so a plain script can load this file.

import type { SourceId } from '../../src/core/types';

export type Cell = string | number | Date | null;

export type SourceData = {
  fileName: string;
  sheet: string;
  header: string[];
  rows: Cell[][];
};

const d = (day: number) => new Date(Date.UTC(2026, 9, day)); // an Excel date near IST midnight
const total = (n: number, cols: number, at: number): Cell[] => Array.from({ length: cols }, (_, i) => (i === at ? n : null));

export const MONTH_DATA: Readonly<Record<SourceId, SourceData>> = {
  ipAdmissions: {
    fileName: 'IP Admissions report oct2026.xlsx',
    sheet: 'Sheet1',
    header: ['ADMISSIONNO', 'ADMISSIONDT', 'DOCTORNAME', 'DEPARTMENTNAME', 'ORGANIZATIONNAME'],
    rows: [['IP1', d(1), 'Dr. A Kumar', 'cardiology', 'GENERAL']],
  },
  ipDischarge: {
    fileName: 'IP Discharge Report Oct2026.xlsx',
    sheet: 'Sheet1',
    header: ['ADMISSIONNO', 'DISCHARGEDT', 'DOCTORNAME', 'DEPARTMENTNAME', 'ORGANIZATIONNAME', 'GROSSAMOUNT', 'CONCESSION', 'Net Amount'],
    rows: [
      ['IP1', d(5), 'Dr. A Kumar', 'cardiology', 'GENERAL', 11000, 500, 10500],
      ['IP2', d(6), ' dr  a kumar', 'CARDIOLOGY', 'STAR', 2000, 0, 2000],
      ['IP3', d(7), 'B Rao', 'urology', 'GENERAL', 3000, 100, 2900],
      ['IP4', d(8), 'Dr Unknown', 'ENT', 'GENERAL', 800, 0, 800],
      total(16800, 8, 5),
    ],
  },
  ipGeneralBill: {
    fileName: 'IP General Bill Breakup Oct2026.xlsx',
    sheet: 'Sheet1',
    header: ['BILLNO', 'BILLDT', 'ADMISSIONNO', 'GROSSAMOUNT', 'CONCESSION', 'BILLSTATUS', 'DOCTORNAME', 'DEPARTMENTNAME', 'ORGNAME'],
    rows: [
      ['G1', '02-OCT-2026', 'IP1', 10000.5, 500.25, 'CLEARED', 'Dr. A Kumar', 'cardiology', 'GENERAL'],
      ['G2', '03-OCT-2026', 'IP2', 2000, 0, 'PENDING', 'Dr. A Kumar', 'cardiology', 'STAR'],
      ['G3', '04-OCT-2026', 'IP3', 'abc', 0, 'CLEARED', 'B Rao', 'urology', 'GENERAL'], // unreadable amount
      ['G4', '05-NOV-2026', 'IP3', 3000, 100, 'CLEARED', 'B Rao', 'urology', 'GENERAL'], // dated outside the month
    ],
  },
  ipBillBreakups: {
    fileName: 'IP Bill Breakups oct2026.xlsx',
    sheet: 'Sheet1',
    header: ['ADMISSIONNO', 'BILLNO', 'BILLDT', 'DOCTORNAME', 'DEPARTMENTNAME', 'ORGANIZATIONNAME', 'GROSS', 'CONCESSION', 'PHARMACY', 'PHARPURCAMOUNT', 'UMRNO', 'BILLTYPE'],
    rows: [
      ['IP1', 'CB1', '02-OCT-2026', 'Dr. A Kumar', 'cardiology', 'GENERAL', 10000, 0, 1000.1, 600.05, 'U1', 'C'],
      ['IP3', 'CB2', '04-OCT-2026', 'B Rao', 'urology', 'GENERAL', 3000, 0, 500, 300, 'U3', 'G'],
    ],
  },
  opBilling: {
    fileName: 'OP Billing Report Oct2026.xlsx',
    sheet: 'Sheet1',
    header: ['BILLNO', 'BILLDT', 'UMRNO', 'DOCTORNAME', 'DEPARTMENTNAME', 'NETAMOUNT', 'BILLTYPE', 'ORGANIZATIONNAME'],
    rows: [
      ['B1', d(2), 'U1', 'Dr. A Kumar', 'cardiology', 400, 'OP', 'GENERAL'],
      ['B2', d(3), 'U2', 'B Rao', 'urology', 250.5, 'Corporate.', 'STAR'],
      total(650.5, 8, 5),
    ],
  },
  opConsultations: {
    fileName: 'OP Consultations Report Oct2026.xlsx',
    sheet: 'Sheet1',
    header: ['CONSULTATIONNO', 'CONSULTATIONDT', 'UMRNO', 'DOCTORNAME', 'DEPARTMENTNAME', 'Net Amount', 'ORGANIZATIONNAME'],
    rows: [
      ['C1', d(2), 'U1', 'Dr. A Kumar', 'cardiology', 300, 'GENERAL'],
      ['C2', d(3), 'U2', 'B Rao', 'urology', 200, 'STAR'],
      ['C3', d(10), 'U2', 'Dr. A Kumar', 'cardiology', 100, 'STAR'], // U2 has two consultations
      total(600, 7, 5),
    ],
  },
  opPharmacySales: {
    fileName: 'gst op pharmacy sales oct 2026.xlsx',
    sheet: 'OP pharmacy sales data',
    header: ['BILLNO', 'BILLDT', 'UMRNO', 'ADMNNO', 'ORGANIZATIONNAME', 'SALEVALUE_BEFORETAX', 'PURCHASEVALUE_BEFORE_TAX'],
    rows: [
      ['S1', d(2), 'U1', null, 'GENERAL', 100, 60], // one consultation -> A, Matched
      ['S1', d(2), 'U1', null, 'GENERAL', 0, 0], // a second line of the same bill
      ['S2', d(5), 'U2', null, 'STAR', 200, 120], // latest consultation on or before -> B, Fallback
      ['S3', d(20), 'U2', null, 'STAR', 50, 30], // latest on or before the 20th is C3 -> A, Fallback
      ['S4', d(6), 'U9', null, 'GENERAL', 70.3, 40], // no consultation -> Unattributed
      ['S5', d(7), 'U1', 'IP9', 'GENERAL', 500, 300], // an in-patient: IP via OP pharmacy
    ],
  },
  opReturns: {
    fileName: 'op returns report oct 2026.xlsx',
    sheet: 'Sheet1',
    header: ['BILLNO', 'BILLDT', 'ORIGINAL_BILLNO', 'UMRNO', 'ADMISSIONNO', 'ORGANIZATIONNAME', 'SALEVALUE_BEFORETAX'],
    rows: [
      ['R1', d(9), 'S1', 'U1', null, 'GENERAL', 30], // an OP return -> A, -30
      ['R2', d(9), 'S5', 'U1', 'IP9', 'GENERAL', 80], // an in-patient return
    ],
  },
};
