// A small made-up month (October 2026) covering the rules and attribution cases:
// 2 doctors + 1 unknown, a patient with 2 consultations, OP pharmacy sales and
// returns (including in-patient lines), a bad amount, an out-of-month bill, and
// a grand-total row. No real patient data.

import { loadDefaultRules } from '@/core/defaults';
import type { RunSettings } from '@/core/runMonth';
import { DEFAULT_SOURCE_MAPPINGS } from '@/core/sourceDefaults';
import type { DoctorMaster, SourceId } from '@/core/types';
import { hisFile } from './syntheticWorkbook';

type Cell = string | number | Date | null;

export const MONTH = '2026-10';
export const DR_A = 'a-kumar';
export const DR_B = 'b-rao';

const d = (day: number) => new Date(Date.UTC(2026, 9, day)); // an Excel date near IST midnight
const total = (n: number, cols: number, at: number): Cell[] => Array.from({ length: cols }, (_, i) => (i === at ? n : null));

export const DOCTORS: DoctorMaster[] = [
  { id: DR_A, displayName: 'A Kumar', department: 'Cardiology', aliases: ['Dr. A Kumar'] },
  { id: DR_B, displayName: 'B Rao', department: 'Urology', aliases: [] },
];

export function monthSettings(overrides: { flags?: Partial<RunSettings['rules']['flags']> } = {}): RunSettings {
  const rules = loadDefaultRules();
  rules.flags = { ...rules.flags, ...overrides.flags };
  return {
    sources: { version: 1, sources: DEFAULT_SOURCE_MAPPINGS.map((m) => structuredClone(m)) },
    doctors: { version: 1, doctors: structuredClone(DOCTORS), departments: [], sponsors: [] },
    rules,
  };
}

const IP_DISCHARGE = ['ADMISSIONNO', 'DISCHARGEDT', 'DOCTORNAME', 'DEPARTMENTNAME', 'ORGANIZATIONNAME', 'GROSSAMOUNT', 'CONCESSION', 'Net Amount'];
const IP_GENERAL = ['BILLNO', 'BILLDT', 'ADMISSIONNO', 'GROSSAMOUNT', 'CONCESSION', 'BILLSTATUS', 'DOCTORNAME', 'DEPARTMENTNAME', 'ORGNAME'];
const IP_BREAKUPS = ['ADMISSIONNO', 'BILLNO', 'BILLDT', 'DOCTORNAME', 'DEPARTMENTNAME', 'ORGANIZATIONNAME', 'GROSS', 'CONCESSION', 'PHARMACY', 'PHARPURCAMOUNT', 'UMRNO', 'BILLTYPE'];
const OP_BILLING = ['BILLNO', 'BILLDT', 'UMRNO', 'DOCTORNAME', 'DEPARTMENTNAME', 'NETAMOUNT', 'BILLTYPE', 'ORGANIZATIONNAME'];
const OP_CONSULT = ['CONSULTATIONNO', 'CONSULTATIONDT', 'UMRNO', 'DOCTORNAME', 'DEPARTMENTNAME', 'Net Amount', 'ORGANIZATIONNAME'];
const PHARMACY = ['BILLNO', 'BILLDT', 'UMRNO', 'ADMNNO', 'ORGANIZATIONNAME', 'SALEVALUE_BEFORETAX', 'PURCHASEVALUE_BEFORE_TAX'];
const RETURNS = ['BILLNO', 'BILLDT', 'ORIGINAL_BILLNO', 'UMRNO', 'ADMISSIONNO', 'ORGANIZATIONNAME', 'SALEVALUE_BEFORETAX'];

/** The 8 source files of the made-up month. */
export function monthFiles(): Record<SourceId, File> {
  return {
    ipAdmissions: hisFile('IP Admissions report oct2026.xlsx', ['ADMISSIONNO', 'ADMISSIONDT', 'DOCTORNAME', 'DEPARTMENTNAME', 'ORGANIZATIONNAME'], [
      ['IP1', d(1), 'Dr. A Kumar', 'cardiology', 'GENERAL'],
    ]),
    ipDischarge: hisFile('IP Discharge Report Oct2026.xlsx', IP_DISCHARGE, [
      ['IP1', d(5), 'Dr. A Kumar', 'cardiology', 'GENERAL', 11000, 500, 10500],
      ['IP2', d(6), ' dr  a kumar', 'CARDIOLOGY', 'STAR', 2000, 0, 2000],
      ['IP3', d(7), 'B Rao', 'urology', 'GENERAL', 3000, 100, 2900],
      ['IP4', d(8), 'Dr Unknown', 'ENT', 'GENERAL', 800, 0, 800],
      total(16800, 8, 5),
    ]),
    ipGeneralBill: hisFile('IP General Bill Breakup Oct2026.xlsx', IP_GENERAL, [
      ['G1', '02-OCT-2026', 'IP1', 10000.5, 500.25, 'CLEARED', 'Dr. A Kumar', 'cardiology', 'GENERAL'],
      ['G2', '03-OCT-2026', 'IP2', 2000, 0, 'PENDING', 'Dr. A Kumar', 'cardiology', 'STAR'],
      ['G3', '04-OCT-2026', 'IP3', 'abc', 0, 'CLEARED', 'B Rao', 'urology', 'GENERAL'],
      ['G4', '05-NOV-2026', 'IP3', 3000, 100, 'CLEARED', 'B Rao', 'urology', 'GENERAL'],
    ]),
    ipBillBreakups: hisFile('IP Bill Breakups oct2026.xlsx', IP_BREAKUPS, [
      ['IP1', 'CB1', '02-OCT-2026', 'Dr. A Kumar', 'cardiology', 'GENERAL', 10000, 0, 1000.1, 600.05, 'U1', 'C'],
      ['IP3', 'CB2', '04-OCT-2026', 'B Rao', 'urology', 'GENERAL', 3000, 0, 500, 300, 'U3', 'G'],
    ]),
    opBilling: hisFile('OP Billing Report Oct2026.xlsx', OP_BILLING, [
      ['B1', d(2), 'U1', 'Dr. A Kumar', 'cardiology', 400, 'OP', 'GENERAL'],
      ['B2', d(3), 'U2', 'B Rao', 'urology', 250.5, 'Corporate.', 'STAR'],
      total(650.5, 8, 5),
    ]),
    opConsultations: hisFile('OP Consultations Report Oct2026.xlsx', OP_CONSULT, [
      ['C1', d(2), 'U1', 'Dr. A Kumar', 'cardiology', 300, 'GENERAL'],
      ['C2', d(3), 'U2', 'B Rao', 'urology', 200, 'STAR'],
      ['C3', d(10), 'U2', 'Dr. A Kumar', 'cardiology', 100, 'STAR'], // U2 has two consultations
      total(600, 7, 5),
    ]),
    opPharmacySales: hisFile(
      'gst op pharmacy sales oct 2026.xlsx',
      PHARMACY,
      [
        ['S1', d(2), 'U1', null, 'GENERAL', 100, 60], // one consultation -> A, Matched
        ['S1', d(2), 'U1', null, 'GENERAL', 0, 0], // a second line of the same bill
        ['S2', d(5), 'U2', null, 'STAR', 200, 120], // latest consultation on or before -> B, Fallback
        ['S3', d(20), 'U2', null, 'STAR', 50, 30], // latest on or before 20th is C3 -> A, Fallback
        ['S4', d(6), 'U9', null, 'GENERAL', 70.3, 40], // no consultation -> Unattributed
        ['S5', d(7), 'U1', 'IP9', 'GENERAL', 500, 300], // an in-patient: IP via OP pharmacy
      ],
      'OP pharmacy sales data',
    ),
    opReturns: hisFile('op returns report oct 2026.xlsx', RETURNS, [
      ['R1', d(9), 'S1', 'U1', null, 'GENERAL', 30], // an OP return -> A, -30
      ['R2', d(9), 'S5', 'U1', 'IP9', 'GENERAL', 80], // an in-patient return
    ]),
  };
}

export function monthRequest(settings = monthSettings()) {
  const files = monthFiles();
  return {
    month: MONTH,
    settings,
    files: (Object.keys(files) as SourceId[]).map((sourceId) => ({ sourceId, file: files[sourceId] })),
  };
}
