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
| ipGeneralBill | IP General Bill Breakup | Sheet1 | BILLNO, BILLDT (text), ADMISSIONNO, GROSSAMOUNT, CONCESSION, BILLSTATUS, DOCTORNAME, DEPARTMENTNAME, ORGNAME (sponsor, col AH) |
| ipBillBreakups | IP Bill Breakups | Sheet1 | BILLNO, BILLDT (text), ADMISSIONNO, DOCTORNAME, DEPARTMENTNAME, ORGANIZATIONNAME, GROSS, PHARMACY, PHARPURCAMOUNT, BILLTYPE |
| opBilling | OP Billing Report | Sheet1 | BILLNO, BILLDT, UMRNO, DOCTORNAME, DEPARTMENTNAME, NETAMOUNT, BILLTYPE, ORGANIZATIONNAME |
| opConsultations | OP Consultations Report | Sheet1 | CONSULTATIONNO, CONSULTATIONDT, UMRNO, DOCTORNAME, DEPARTMENTNAME, Net Amount (formula `+J-K` → read cached value), ORGANIZATIONNAME |
| opPharmacySales | gst op pharmacy sales | "OP pharmacy sales data" (3rd of 5 sheets; the others are pivots / summaries) | BILLNO, BILLDT, UMRNO, ADMNNO, ORGANIZATIONNAME, SALEVALUE_BEFORETAX, PURCHASEVALUE_BEFORE_TAX |
| opReturns | op returns report | Sheet1 (not `returns op`, see below) | BILLNO, BILLDT, ORIGINAL_BILLNO, UMRNO, ADMISSIONNO, ORGANIZATIONNAME, SALEVALUE_BEFORETAX |

Things to know about these files (from `scripts/profile-samples.ts`, October 2026):

- Doctor names vary in case, leading spaces and dots: 84 raw spellings collapse to 46 normalised names.
- Department names vary in case.
- Pharmacy has **no doctor column**.
- **Sponsor column name differs:** ipGeneralBill calls it `ORGNAME`; all others use `ORGANIZATIONNAME`.
- **IP column name differs:** opPharmacySales uses `ADMNNO`, opReturns uses `ADMISSIONNO`.
- **Text dates:** `BILLDT` / `ADMISSIONDT` / `DISCHARGEDT` in ipGeneralBill and ipBillBreakups are text like `02-OCT-2026`, not Excel dates. Parse `DD-MON-YYYY`.
- **Duplicate header:** ipBillBreakups has `ADMISSIONDT` twice (col C as text, col AS as a date). Column mapping must handle duplicate header names (e.g. by column letter or first/second occurrence).
- **Grand-total footer row:** ipDischarge, opBilling and opConsultations end with a totals row that has no ID (e.g. ADMISSIONNO / BILLNO blank). Skip it as data (counted in Checks), but it can be used for the source-total check.
- **Excel dates are IST:** SheetJS returns dates like `2026-10-11T18:30:00Z` (= 12 Oct IST midnight). Convert to calendar dates in Asia/Kolkata, never by slicing the UTC ISO string.
- **Pharmacy files are line-item level:** one row per item, so BILLNO repeats (opPharmacySales: 12,586 rows ≈ 2,973 bills). The "duplicate bill no." check does not apply to opPharmacySales or opReturns.
- **opReturns extra sheets:** `Sheet4` is a pivot; `returns op` is a hand-filtered copy of Sheet1 holding only rows with empty ADMISSIONNO (OP returns). Read Sheet1 and apply the filter in the rule instead.
- **Values seen:** ipGeneralBill BILLSTATUS = `CLEARED` (346) / `PENDING` (215). opBilling BILLTYPE = `OP` / `Corporate.` (with trailing dot). ipBillBreakups BILLTYPE = `C` / `G`. STATUS is `A` on every row where it exists.
- ipDischarge also has a `Net Amount` formula column (`+AB-AD`).
- Other sheets (`Sheet2`, `Sheet3`) in the HIS exports are empty.

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

Sponsor-wise template (`Sponsor-wise Revenue Report.xlsx`): header row 4, columns A–L, same fill approach:
`S.No. | Sponsor Name | Month | IP Count | IP Revenue | OP Revenue | OP Pharmacy | Total Revenue | OP Pharmacy Cost | IP Pharmacy revenue Net | Ip Pharmacy Cost | Gross Profit`

- No Department, Departmental Issues Cost, Salary Cost, Incentives or Professional Fee columns.
- Row 2 has `SUBTOTAL(9, X5:X960)` totals.
- Rows 5–496 are pre-numbered (S.No. is not strictly sequential) and contain formulas:
  - `Total Revenue = E+F+G`
  - `Gross Profit = H-I-K`

## Default DRR recipe (the rules finance confirmed, October 2026)

This is the source of truth for the starter recipes in `src/recipe/defaults/` (`drr.recipe.json`, `sponsorwise.recipe.json`).
The app is recipe-based (`src/recipe`, `src/engine`). The sections above and below that describe the workspace folder,
fact rows, `rules.json`, measures and run folders belong to the older design and are kept for the file facts only. Where they
disagree with this section, this section wins. Rules are data in the recipe, never hard-coded in the engine.

**Sources.** The 7 files of the table above are used (IP Admissions is not used and is listed in Checks as *Files not used*).
`costs` is an optional 8th source (columns Doctor, Departmental Issues Cost, Salary Cost, Incentives, Professional Fee).

**Cleanup (Doctor).** Dots become spaces, then spaces collapse; a leading "DR " and a trailing " (REVIEW)" are stripped; title
case. `K.KRISHNA CHAND` → `K Krishna Chand`, `G.AJAY KUMAR.` → `G Ajay Kumar`, `Dr Srimannarayana (Review)` → `Srimannarayana`.
(So `BALA KRISHNA SANAMPUDI (REVIEW)` is the same doctor as `BALA KRISHNA SANAMPUDI`.) Department: dots removed, title case.

**Lookups (pharmacy → doctor).** OP Pharmacy and OP Returns rows with no admission number take the doctor of the OP
consultation with the same UMRNO: the latest consultation on or before the bill date (calendar days, IST), else the nearest
later one (`Fallback`). If the chosen day holds consultations of different doctors the row is `Ambiguous`; the tie-break prefers a
doctor whose name does not contain "Consultation" or "Check Up", then takes the first. No consultation → `Pharmacy – Unattributed`.
Status counts and amounts are in Checks.

**DRR columns** (one rule each; `[Source]` is the source label):

| Column | Rule |
|---|---|
| IP Count | SUM IPCount where Source = IP Discharge (1 per row) |
| IP Revenue | SUM Amount (Gross − Concession) where Source = IP General Bill (PENDING bills included) |
| **OP Revenue** | SUM Amount where Source = OP Billing **or** OP Consultations |
| OP Pharmacy | SUM Amount where Source = OP Pharmacy or OP Returns (sales net of returns) |
| OP Pharmacy Cost | SUM Cost where Source = OP Pharmacy |
| IP Pharmacy revenue Net, Ip Pharmacy Cost | SUM IPPharmacy / IPPharmacyCost (IP Bill Breakups) |
| Departmental Issues, Salary, Incentives, Professional Fee | from the optional Costs file; 0 without it |
| Total Revenue | IP Revenue + OP Revenue + OP Pharmacy |
| Gross Profit | Total Revenue − OP Pharmacy Cost − Ip Pharmacy Cost − Departmental Issues − Salary − Incentives − Professional Fee |

Sponsor-wise uses the same rules by Sponsor (no cost columns); its Gross Profit is Total Revenue − OP Pharmacy Cost − Ip Pharmacy Cost.

**Decisions.**
1. **OP Revenue = OP Billing + OP Consultations**, in both reports. Each has its own tie-out (source total row vs its share of OP Revenue).
2. **OP pharmacy sold to admitted patients** (ADMNNO / ADMISSIONNO filled) stays out of OP Pharmacy: it is billed in the IP bill.
   The source filters stay; Checks show *Pharmacy to admitted patients excluded (billed in IP bill)* with the rows and the amount.
3. **Unattributed pharmacy is not in the DRR.** `report.excludeRowsWhere` = `[Doctor]="Pharmacy – Unattributed"`, applied before
   grouping (no row, no total). Checks show *Excluded from report: unattributed OP pharmacy* with the lines, sales and cost, split
   into *no UMRNO (counter sales)* and *UMRNO with no consultation this month*. The OP Pharmacy tie-out is
   **source total = report total + excluded total**; a mismatch is an **Error** and blocks the download. The Sponsor-wise recipe
   excludes nothing: those rows stay under their sponsor.
4. **Gross Profit** is unchanged. A missing Costs file is a **warning**: *Costs file not uploaded — Departmental Issues, Salary,
   Incentives and Professional Fee are 0, so Gross Profit is before these costs.* (DRR only.)
5. The DRR hides rows where every aggregate column is 0 (listed in Checks; the totals still count them).

**October 2026 totals the golden test pins** (`tests/golden/drr.test.ts`, Month = `Oct-2026`): OP Revenue ₹31,36,235.60
(OP Billing ₹23,64,677.60 + OP Consultations ₹7,71,558.00); IP Count 499; IP Revenue ₹3,97,19,088.00; IP Pharmacy revenue Net
₹1,23,73,098.00; Ip Pharmacy Cost ₹55,16,177.00; OP Pharmacy ₹17,50,813.19 in Sponsor-wise and the same minus the excluded
unattributed pharmacy in the DRR.

## Default measure rules (older design — superseded by "Default DRR recipe" above)

| Measure | Source | Value | Filter / notes |
|---|---|---|---|
| IP_COUNT | ipDischarge | 1 per row | — |
| IP_REVENUE | ipGeneralBill | GROSSAMOUNT − CONCESSION | include PENDING? (config flag) |
| OP_REVENUE | opBilling | NETAMOUNT | opConsultations added only if `includeConsultations` flag is on |
| OP_PHARMACY | opPharmacySales − opReturns | SALEVALUE_BEFORETAX | only rows with empty ADMNNO (sales) / empty ADMISSIONNO (returns); doctor via attribution |
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
