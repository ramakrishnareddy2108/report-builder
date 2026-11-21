# CLAUDE.md — DRR Report Builder

Read this file fully before every task. It is the project brief and the source of truth.
If a request conflicts with this file, stop and ask.

## What we are building

A small browser app for 2–3 finance users at G2 Health Care. Each month it turns 8 Excel
exports from the hospital HIS into two reports:

- **DRR** (Doctor-wise Revenue Report)
- **Sponsor-wise Revenue Report**

It also keeps every month for comparison and offers simple dashboards (v2).

- No server, no login, no database server. Everything runs in the browser (Chrome / Edge only).
- Hosted as static files on GitHub Pages.
- Data is saved in a **workspace folder** on the user's laptop via the File System Access API.

## Non-negotiables (accuracy first)

1. **Money is stored in paise as integers** (`number` holding whole paise).
   - Convert once on read: `Math.round(rupees * 100)`.
   - Format only at display or export.
   - Never sum floats.
2. **Each DRR column has exactly one defined rule** (source + value + filter).
   - Never add two sources unless a rule explicitly says so.
3. **Never drop data silently.**
   - Every skipped row is counted and shown in Checks, with a reason.
   - Every unmatched doctor is counted and shown in Checks.
   - Every unparseable amount is counted and shown in Checks.
4. **Never store patient names, phone numbers or addresses.**
   - Keep only: bill/admission/consultation numbers, UMRNO, dates, doctor, department, sponsor, amounts, source file name and row number.
5. **Each run saves a copy of the settings it used** (`settings-used.json`).
   - A Final run is read-only.
6. **Escape Excel output text.** Text starting with `=`, `+`, `-` or `@` gets a leading `'`.
7. **Patient data never goes into git.**
   - `samples/` and any `*.xlsx` outside `tests/fixtures/synthetic/` are git-ignored.

## Tech stack (do not add libraries without asking)

| Need | Choice |
|---|---|
| App | React 18+ + TypeScript (strict) + Vite |
| UI | Tailwind CSS + shadcn/ui |
| State | Zustand |
| Grids | AG Grid Community (`ag-grid-react`) |
| Charts | Apache ECharts (`echarts-for-react`) — v2 |
| Read Excel | SheetJS, installed from the official tarball: `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (the npm registry copy is outdated) |
| Write Excel | ExcelJS (template filling, keeps formatting and formulas) |
| Validation | Zod (settings, backups, imports) |
| Folder handle persistence | idb-keyval |
| Backup zip | JSZip |
| Worker | Plain Web Worker (`new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`) |
| Tests | Vitest |
| Deploy | GitHub Actions → GitHub Pages |

## Folder structure

```
src/
  app/            shell, routing (simple tab state, no router library), layout
  pages/          Workspace, Sources, Doctors, Costs, Run, Months, Dashboards, Settings
  components/     shared UI
  core/
    money.ts      paise helpers
    types.ts      domain types
    schemas.ts    Zod schemas for every persisted JSON
    measures.ts   DRR measure registry (single definition used everywhere)
    rules.ts      apply measure rules -> fact rows
    attribution.ts pharmacy -> doctor
    doctors.ts    name normalisation, alias matching
    checks.ts     Pass / Warning / Fail checks
    aggregate.ts  group-by helpers (doctor, department, sponsor, month)
  formula/        tokenizer, parser, evaluator, function registry (no eval)
  excel/          readWorkbook.ts, detectHeader.ts, fillTemplate.ts, escape.ts
  storage/        workspace.ts (File System Access), backup.ts
  worker/         runMonth.worker.ts
tests/
  unit/
  fixtures/synthetic/   small made-up Excel files (committed)
  golden/               reads samples/ locally; skipped in CI if samples/ missing
samples/                REAL hospital files — git-ignored
```

## Workspace folder layout (on the user's laptop)

```
<workspace>/
  settings/
    sources.json      per-source mapping (sheet, header row, field -> column | fixed | formula, row filter, name pattern)
    doctors.json      doctor master: id, displayName, department, aliases[]
    rules.json        measure rules for DRR + Sponsor-wise
    costs-defaults.json
    templates/        DRR Format.xlsx, Sponsor-wise Revenue Report.xlsx
    dashboards.json   (v2)
  data/<YYYY-MM>/run-<n>/
    facts.json  costs.json  checks.json  settings-used.json  run-info.json
  output/<YYYY-MM>/   generated workbooks
```

`run-info.json` holds: month, runNumber, status (Draft | Final), createdAt, operatorName (self-declared), reason, file fingerprints (SHA-256).

## The 8 sources (October 2026 samples)

All have 2 title rows. The header is on row 3.

| Source id | File name pattern | Sheet | Key columns |
|---|---|---|---|
| ipAdmissions | IP Admissions report | Sheet1 | ADMISSIONNO, ADMISSIONDT, DOCTORNAME, DEPARTMENTNAME, ORGANIZATIONNAME |
| ipDischarge | IP Discharge Report | Sheet1 | ADMISSIONNO, DISCHARGEDT, DOCTORNAME, DEPARTMENTNAME, ORGANIZATIONNAME, GROSSAMOUNT, CONCESSION |
| ipGeneralBill | IP General Bill Breakup | Sheet1 | BILLNO, BILLDT, ADMISSIONNO, GROSSAMOUNT, CONCESSION, BILLSTATUS, DOCTORNAME, DEPARTMENTNAME, (org name in a later column) |
| ipBillBreakups | IP Bill Breakups | Sheet1 | BILLNO, ADMISSIONNO, DOCTORNAME, DEPARTMENTNAME, ORGANIZATIONNAME, GROSS, PHARMACY, PHARPURCAMOUNT |
| opBilling | OP Billing Report | Sheet1 | BILLNO, BILLDT, UMRNO, DOCTORNAME, DEPARTMENTNAME, NETAMOUNT, BILLTYPE |
| opConsultations | OP Consultations Report | Sheet1 | CONSULTATIONNO, CONSULTATIONDT, UMRNO, DOCTORNAME, DEPARTMENTNAME, Net Amount (formula cell → read cached value), ORGANIZATIONNAME |
| opPharmacySales | gst op pharmacy sales | "OP pharmacy sales data" (3rd sheet; others are pivots) | BILLNO, BILLDT, UMRNO, ADMNNO, ORGANIZATIONNAME, SALEVALUE_BEFORETAX, PURCHASEVALUE_BEFORE_TAX |
| opReturns | op returns report | Sheet1 | BILLNO, BILLDT, ORIGINAL_BILLNO, UMRNO, ADMISSIONNO, ORGANIZATIONNAME, SALEVALUE_BEFORETAX |

Things to know about these files:

- Doctor names vary in case, leading spaces and dots: 84 raw spellings collapse to 46 normalised names.
- Department names vary in case.
- Pharmacy has **no doctor column**.

## DRR output (template: `DRR Format.xlsx`)

- Header row 4, columns A–Q:
  `S.No. | Doctor Name | Department | Month | IP Count | IP Revenue | OP Revenue | OP Pharmacy | Total Revenue | OP Pharmacy Cost | IP Pharmacy revenue Net | Ip Pharmacy Cost | Departmental Issues Cost | Salary Cost | Incentives | Professional Fee | Gross Profit`
- Row 2 has `SUBTOTAL(9, X5:X960)` totals.
- Rows 5+ already contain S.No. and formulas:
  - `Total Revenue = F+G+H`
  - `Gross Profit = I-J-L-M-N-O-P`
- **Fill approach (table fill, not placeholders):**
  - Find the header row by matching header names.
  - Write one row per doctor (per month) from row 5.
  - Write values only into input columns.
  - **Keep the template's formula cells.**
  - Clear unused pre-numbered rows.
  - The tool also computes Total Revenue and Gross Profit itself, and a Check compares them with the template formula logic.

Sponsor-wise template: same layout, header row 4, `Sponsor Name` instead of Doctor / Department, no salary or incentive columns. Same fill approach.

## Default measure rules (proposed — must be confirmed against a filled October DRR)

| Measure | Source | Value | Filter / notes |
|---|---|---|---|
| IP_COUNT | ipDischarge | 1 per row | — |
| IP_REVENUE | ipGeneralBill | GROSSAMOUNT − CONCESSION | include PENDING? (config flag) |
| OP_REVENUE | opBilling | NETAMOUNT | opConsultations added only if `includeConsultations` flag is on |
| OP_PHARMACY | opPharmacySales − opReturns | SALEVALUE_BEFORETAX | only rows with empty ADMNNO; doctor via attribution |
| OP_PHARMACY_COST | opPharmacySales | PURCHASEVALUE_BEFORE_TAX | same rows and attribution |
| IP_PHARMACY_NET | ipBillBreakups | PHARMACY | — |
| IP_PHARMACY_COST | ipBillBreakups | PHARPURCAMOUNT | — |
| DEPT_ISSUES, SALARY, INCENTIVES, PROF_FEE | costs | entered per doctor | — |
| TOTAL_REVENUE | calc | IP_REVENUE + OP_REVENUE + OP_PHARMACY | — |
| GROSS_PROFIT | calc | TOTAL_REVENUE − OP_PHARMACY_COST − IP_PHARMACY_COST − DEPT_ISSUES − SALARY − INCENTIVES − PROF_FEE | — |

Rules are data (`rules.json`) editable in the UI, not hard-coded logic.
The defaults above ship as the initial `rules.json`.

## Pharmacy attribution (in order)

1. ADMNNO filled → IP patient → excluded from OP Pharmacy and counted under a separate "IP via OP pharmacy" line in Checks.
2. UMRNO has exactly one OP consultation in the month → that doctor, status `Matched`.
3. UMRNO has several consultations → the latest on or before the bill date (else the earliest after it), status `Fallback`.
4. No consultation → doctor `Pharmacy – Unattributed`, status `Unattributed`.

Every fact row stores `attributionMethod` and `attributionStatus`.

## Fact row shape

```ts
type FactRow = {
  month: string;            // 'YYYY-MM'
  measure: MeasureCode;     // 'IP_REVENUE' | ...
  amountPaise: number;      // integer; counts use 1 (not paise) and measure.kind === 'count'
  doctorId: string | null;
  departmentId: string | null;
  sponsor: string | null;   // normalised ORGANIZATIONNAME
  sourceId: SourceId;
  sourceFile: string;
  sourceRow: number;        // Excel row number
  ref: string | null;       // bill / admission / consultation no.
  umrno: string | null;
  txnDate: string | null;   // ISO date
  attributionMethod?: string;
  attributionStatus?: 'Matched' | 'Fallback' | 'Unattributed';
};
```

## Checks (Fail blocks Final; Warning needs a typed note)

**Fail:**
- mapped source missing
- mapped / formula column missing
- unreadable amount in a used column
- identical file loaded twice
- duplicate bill no. where unique
- source total ≠ report total (> ₹1)

**Warning:**
- unknown doctor name
- Fallback / Unattributed pharmacy rows
- OP Billing vs Consultations overlap
- rows dated outside the month
- doctor or department change vs previous month > 50%

## Formula language (row formulas and report formulas)

- Excel-like:
  - `[Column Name]` or `[F]` for a column
  - `"text"` for text
  - operators `+ - * / ^ & = <> < > <= >=` and `%`
- Functions:
  - logic: IF, IFS, IFERROR, AND, OR, NOT
  - maths: ROUND, ROUNDUP, ROUNDDOWN, INT, ABS, MIN, MAX, SUM, AVERAGE, MOD
  - text: UPPER, LOWER, PROPER, TRIM, LEFT, RIGHT, MID, LEN, CONCAT, SUBSTITUTE, SEARCH, CONTAINS
  - checks: ISBLANK, ISNUMBER, VALUE
  - dates: YEAR, MONTH, DAY
- Behaviour:
  - Blank = 0 for numbers and "" for text.
  - Divide by zero → error (IFERROR catches it).
  - Text comparison is case-insensitive.
- Implementation: tokenizer → recursive-descent parser → AST → evaluator. Never `eval` or `Function`.

## Coding rules

- TypeScript strict. No `any` in `core/`, `formula/` or `excel/`.
- Business logic stays out of React components.
  - `core/`, `formula/` and `excel/` are pure functions.
  - They are unit-tested.
- Heavy work (reading big files, running a month) runs in the worker.
- Every persisted JSON is validated with Zod on load.
- UI is simple and clean:
  - left sidebar nav
  - shadcn components
  - clear empty states
  - errors shown in plain language
- After each task:
  - run `npm run typecheck`, `npm run test` and `npm run build`
  - fix failures
  - summarise what changed and how to test it manually
- Small commits with clear messages. Do not push unless asked.
