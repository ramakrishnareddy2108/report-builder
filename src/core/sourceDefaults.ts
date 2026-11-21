// Starting mappings for the 8 HIS sources (October 2026 exports, see CLAUDE.md).
// They pre-fill the Sources page so first-time setup is mostly "confirm".
// Nothing here is saved until the user confirms it.

import type { FieldKey, FieldMapping, SourceId, SourceMapping } from './types';

const col = (value: string): FieldMapping => ({ type: 'column', value });

function mapping(
  sourceId: SourceId,
  namePattern: string,
  fields: Partial<Record<FieldKey, string>>,
  opts: { sheet?: string; refUnique?: boolean } = {},
): SourceMapping {
  return {
    sourceId,
    sheet: opts.sheet ?? 'Sheet1',
    headerRow: 3,
    namePattern,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, col(v)])),
    rowFilter: null,
    refUnique: opts.refUnique ?? true,
  };
}

export const DEFAULT_SOURCE_MAPPINGS: readonly SourceMapping[] = [
  mapping('ipAdmissions', 'IP Admissions report', {
    ref: 'ADMISSIONNO',
    txnDate: 'ADMISSIONDT',
    doctor: 'DOCTORNAME',
    department: 'DEPARTMENTNAME',
    sponsor: 'ORGANIZATIONNAME',
  }),
  mapping('ipDischarge', 'IP Discharge Report', {
    ref: 'ADMISSIONNO',
    txnDate: 'DISCHARGEDT',
    doctor: 'DOCTORNAME',
    department: 'DEPARTMENTNAME',
    sponsor: 'ORGANIZATIONNAME',
    grossAmount: 'GROSSAMOUNT',
    concession: 'CONCESSION',
    netAmount: 'Net Amount',
  }),
  mapping('ipGeneralBill', 'IP General Bill Breakup', {
    ref: 'BILLNO',
    txnDate: 'BILLDT',
    admissionNo: 'ADMISSIONNO',
    doctor: 'DOCTORNAME',
    department: 'DEPARTMENTNAME',
    sponsor: 'ORGNAME', // differs from the other sources
    status: 'BILLSTATUS',
    grossAmount: 'GROSSAMOUNT',
    concession: 'CONCESSION',
  }),
  mapping('ipBillBreakups', 'IP Bill Breakups', {
    ref: 'BILLNO',
    txnDate: 'BILLDT',
    admissionNo: 'ADMISSIONNO',
    umrno: 'UMRNO',
    doctor: 'DOCTORNAME',
    department: 'DEPARTMENTNAME',
    sponsor: 'ORGANIZATIONNAME',
    billType: 'BILLTYPE',
    grossAmount: 'GROSS',
    concession: 'CONCESSION',
    pharmacyAmount: 'PHARMACY',
    pharmacyCost: 'PHARPURCAMOUNT',
  }),
  mapping('opBilling', 'OP Billing Report', {
    ref: 'BILLNO',
    txnDate: 'BILLDT',
    umrno: 'UMRNO',
    doctor: 'DOCTORNAME',
    department: 'DEPARTMENTNAME',
    sponsor: 'ORGANIZATIONNAME',
    billType: 'BILLTYPE',
    netAmount: 'NETAMOUNT',
  }),
  mapping('opConsultations', 'OP Consultations Report', {
    ref: 'CONSULTATIONNO',
    txnDate: 'CONSULTATIONDT',
    umrno: 'UMRNO',
    doctor: 'DOCTORNAME',
    department: 'DEPARTMENTNAME',
    sponsor: 'ORGANIZATIONNAME',
    netAmount: 'Net Amount', // a formula in the file; its saved value is read
  }),
  mapping(
    'opPharmacySales',
    'gst op pharmacy sales',
    {
      ref: 'BILLNO',
      txnDate: 'BILLDT',
      umrno: 'UMRNO',
      admissionNo: 'ADMNNO', // differs from opReturns
      sponsor: 'ORGANIZATIONNAME',
      saleValue: 'SALEVALUE_BEFORETAX',
      purchaseValue: 'PURCHASEVALUE_BEFORE_TAX',
    },
    { sheet: 'OP pharmacy sales data', refUnique: false }, // one row per item
  ),
  mapping(
    'opReturns',
    'op returns report',
    {
      ref: 'BILLNO',
      txnDate: 'BILLDT',
      originalRef: 'ORIGINAL_BILLNO',
      umrno: 'UMRNO',
      admissionNo: 'ADMISSIONNO',
      sponsor: 'ORGANIZATIONNAME',
      saleValue: 'SALEVALUE_BEFORETAX',
    },
    { refUnique: false },
  ),
];

export function defaultMappingFor(sourceId: SourceId): SourceMapping {
  const found = DEFAULT_SOURCE_MAPPINGS.find((m) => m.sourceId === sourceId);
  if (!found) throw new Error(`No default mapping for ${sourceId}`);
  return structuredClone(found);
}
