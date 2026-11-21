// Domain types (FactRow, MeasureCode, SourceId, ...).
//
// Every persisted shape here has a matching Zod schema in schemas.ts, and a
// compile-time check there keeps the two in step.
// Money is always integer paise (see money.ts).

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const SOURCE_IDS = [
  'ipAdmissions',
  'ipDischarge',
  'ipGeneralBill',
  'ipBillBreakups',
  'opBilling',
  'opConsultations',
  'opPharmacySales',
  'opReturns',
] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

/** OP pharmacy is attributed to doctors using this source's consultations. */
export const ATTRIBUTION_SOURCE_ID: SourceId = 'opConsultations';

/** Names shown to the user. */
export const SOURCE_LABELS: Readonly<Record<SourceId, string>> = {
  ipAdmissions: 'IP Admissions',
  ipDischarge: 'IP Discharge',
  ipGeneralBill: 'IP General Bill Breakup',
  ipBillBreakups: 'IP Bill Breakups',
  opBilling: 'OP Billing',
  opConsultations: 'OP Consultations',
  opPharmacySales: 'OP Pharmacy Sales',
  opReturns: 'OP Returns',
};

/**
 * Logical fields a source can provide. Rules refer to these keys (for example
 * `[grossAmount] - [concession]`), never to raw header text, so a renamed
 * column only needs its mapping fixed, not every rule.
 */
export const FIELD_KEYS = [
  'ref', //           bill / admission / consultation no. (row identity)
  'txnDate', //       bill / admission / discharge / consultation date
  'umrno',
  'admissionNo', //   IP admission no. (ADMISSIONNO / ADMNNO)
  'originalRef', //   original bill no. (returns)
  'doctor',
  'department',
  'sponsor', //       ORGANIZATIONNAME / ORGNAME
  'status', //        BILLSTATUS
  'billType', //      BILLTYPE
  'grossAmount',
  'concession',
  'netAmount',
  'saleValue',
  'purchaseValue',
  'pharmacyAmount',
  'pharmacyCost',
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

/** Names shown to the user, with a hint on what the field is. */
export const FIELD_LABELS: Readonly<Record<FieldKey, { label: string; hint: string }>> = {
  ref: { label: 'Bill / admission no.', hint: 'Identifies the row; rows without it are treated as grand-total rows' },
  txnDate: { label: 'Date', hint: 'Bill, admission, discharge or consultation date' },
  umrno: { label: 'UMR no.', hint: 'Patient registration number (used to attribute pharmacy to a doctor)' },
  admissionNo: { label: 'IP admission no.', hint: 'Filled for in-patients, blank for OP rows' },
  originalRef: { label: 'Original bill no.', hint: 'The bill a return refers to' },
  doctor: { label: 'Doctor', hint: 'Doctor name as written in the file' },
  department: { label: 'Department', hint: 'Department name as written in the file' },
  sponsor: { label: 'Sponsor', hint: 'ORGANIZATIONNAME (ORGNAME in IP General Bill)' },
  status: { label: 'Bill status', hint: 'For example CLEARED or PENDING' },
  billType: { label: 'Bill type', hint: 'For example OP / Corporate. or C / G' },
  grossAmount: { label: 'Gross amount', hint: 'Rupees' },
  concession: { label: 'Concession', hint: 'Rupees' },
  netAmount: { label: 'Net amount', hint: 'Rupees' },
  saleValue: { label: 'Sale value (before tax)', hint: 'Rupees' },
  purchaseValue: { label: 'Purchase value (before tax)', hint: 'Rupees' },
  pharmacyAmount: { label: 'IP pharmacy (net)', hint: 'Rupees' },
  pharmacyCost: { label: 'IP pharmacy cost', hint: 'Rupees' },
};

export type FieldKind = 'id' | 'text' | 'date' | 'money';

export const FIELD_KINDS: Readonly<Record<FieldKey, FieldKind>> = {
  ref: 'id',
  txnDate: 'date',
  umrno: 'id',
  admissionNo: 'id',
  originalRef: 'id',
  doctor: 'text',
  department: 'text',
  sponsor: 'text',
  status: 'text',
  billType: 'text',
  grossAmount: 'money',
  concession: 'money',
  netAmount: 'money',
  saleValue: 'money',
  purchaseValue: 'money',
  pharmacyAmount: 'money',
  pharmacyCost: 'money',
};

/**
 * How one field is read from a source row.
 * - column: by header text (`occurrence` picks the 1st/2nd/... column with that
 *   header, for duplicates such as ADMISSIONDT in ipBillBreakups), or by Excel
 *   column letter when `by` is 'letter'.
 * - fixed: the same value on every row.
 * - formula: a formula over the source's columns (see src/formula).
 * - none: explicitly not used by this source.
 */
export type FieldMapping =
  | { type: 'column'; value: string; by?: 'header' | 'letter'; occurrence?: number }
  | { type: 'fixed'; value: string | number }
  | { type: 'formula'; value: string }
  | { type: 'none'; value: null };

export type SourceMapping = {
  sourceId: SourceId;
  /** Sheet name to read, e.g. 'Sheet1' or 'OP pharmacy sales data'. */
  sheet: string;
  /** 1-based Excel row number of the header row. */
  headerRow: number;
  /** Plain text the file name should contain (case-insensitive; dates and month names ignored). */
  namePattern: string;
  /** A field missing from this record is treated like `{ type: 'none' }`. */
  fields: Partial<Record<FieldKey, FieldMapping>>;
  /** Optional formula over the source's columns; rows where it is false are skipped (and counted). */
  rowFilter: string | null;
  /** Whether `ref` must be unique (false for line-item pharmacy files). */
  refUnique: boolean;
};

// ---------------------------------------------------------------------------
// Doctors
// ---------------------------------------------------------------------------

export type DoctorMaster = {
  id: string;
  displayName: string;
  department: string | null;
  /** Raw spellings seen in the HIS files that map to this doctor. */
  aliases: string[];
};

/** A department or sponsor with the other spellings that mean the same thing. */
export type NameGroup = {
  /** Name shown in reports. */
  name: string;
  /** Other spellings found in the HIS files. */
  aliases: string[];
};

/** Doctor used for OP pharmacy rows that cannot be attributed. */
export const UNATTRIBUTED_DOCTOR_ID = 'pharmacy-unattributed';
export const UNATTRIBUTED_DOCTOR_NAME = 'Pharmacy – Unattributed';

// ---------------------------------------------------------------------------
// Measures and rules
// ---------------------------------------------------------------------------

export const MEASURE_CODES = [
  'IP_COUNT',
  'IP_REVENUE',
  'OP_REVENUE',
  'OP_PHARMACY',
  'OP_PHARMACY_COST',
  'IP_PHARMACY_NET',
  'IP_PHARMACY_COST',
  'DEPT_ISSUES',
  'SALARY',
  'INCENTIVES',
  'PROF_FEE',
  'TOTAL_REVENUE',
  'GROSS_PROFIT',
] as const;
export type MeasureCode = (typeof MEASURE_CODES)[number];

export const COST_MEASURE_CODES = ['DEPT_ISSUES', 'SALARY', 'INCENTIVES', 'PROF_FEE'] as const;
export type CostMeasureCode = (typeof COST_MEASURE_CODES)[number];

/** Switches that turn optional rule terms on or off. */
export const RULE_FLAG_KEYS = ['includePendingIpBills', 'includeConsultations'] as const;
export type RuleFlagKey = (typeof RULE_FLAG_KEYS)[number];
export type RuleFlags = Record<RuleFlagKey, boolean>;

/** What one source row contributes. Formulas refer to field keys, e.g. `[grossAmount] - [concession]`. */
export type RuleValue =
  | { type: 'count' }
  | { type: 'field'; field: FieldKey }
  | { type: 'formula'; formula: string };

/** How a fact row gets its doctor. */
export type AttributionMode = 'sourceDoctor' | 'pharmacyByUmrno';

/** One source contributing to a measure. Most measures have exactly one term. */
export type RuleTerm = {
  sourceId: SourceId;
  value: RuleValue;
  /** Formula over field keys; rows where it is false are left out (and counted). */
  filter: string | null;
  /** -1 for returns, which reduce the measure. */
  sign: 1 | -1;
  attribution: AttributionMode;
  /** The term is used only when this flag has this value. */
  onlyIf?: { flag: RuleFlagKey; is: boolean };
  note?: string;
};

export type MeasureRule =
  | { measure: MeasureCode; kind: 'source'; terms: RuleTerm[] }
  | { measure: MeasureCode; kind: 'costs' };

// ---------------------------------------------------------------------------
// Facts, costs, checks, runs
// ---------------------------------------------------------------------------

export type AttributionStatus = 'Matched' | 'Fallback' | 'Unattributed';

export type FactRow = {
  month: string; //            'YYYY-MM'
  measure: MeasureCode;
  amountPaise: number; //      integer; count measures use 1 per row
  doctorId: string | null;
  departmentId: string | null;
  sponsor: string | null; //   normalised ORGANIZATIONNAME
  sourceId: SourceId;
  sourceFile: string;
  sourceRow: number; //        Excel row number
  ref: string | null; //       bill / admission / consultation no.
  umrno: string | null;
  txnDate: string | null; //   ISO date
  attributionMethod?: string;
  attributionStatus?: AttributionStatus;
};

export type CostEntry = {
  doctorId: string;
  /** Integer paise per cost measure; a missing measure means not entered. */
  amounts: Partial<Record<CostMeasureCode, number>>;
  note?: string;
};

export type CheckLevel = 'Pass' | 'Warning' | 'Fail';

export type CheckExample = {
  sourceFile: string;
  sourceRow: number;
  ref: string | null;
};

export type CheckResult = {
  id: string;
  level: CheckLevel;
  title: string;
  /** Plain-language explanation for the finance user. */
  message: string;
  rows?: number;
  amountPaise?: number;
  examples: CheckExample[];
  /** Extra lines for the user, such as the names behind a count. */
  details?: string[];
  /** Typed note; required on every Warning before a run can be Final. */
  note?: string;
};

export type RunStatus = 'Draft' | 'Final';

export type FileFingerprint = {
  sourceId: SourceId;
  fileName: string;
  sizeBytes: number;
  sha256: string; // 64 lowercase hex chars
};

export type RunInfo = {
  month: string;
  runNumber: number;
  status: RunStatus;
  createdAt: string; //  ISO date-time
  finalizedAt?: string;
  operatorName: string; // self-declared
  reason: string | null; // required when re-running a Final month
  files: FileFingerprint[];
};
