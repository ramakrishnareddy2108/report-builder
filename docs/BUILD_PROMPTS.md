# Build prompts for Claude Code — DRR Report Builder

Paste the prompts one at a time, in order. After each one:

1. Review the changes.
2. Test the app with `npm run dev`.
3. Commit.
4. Move on.

If something is off, tell Claude Code what's wrong before going to the next step.

**Tips**
- Start each step in **Plan mode** (press `Shift+Tab` until it says *plan mode*). Read the plan, then approve it.
- If a step gets long or confused, run `/clear` and paste the step again. `CLAUDE.md` keeps the context.
- Never paste patient data into chat. Point Claude Code at files in `samples/` instead.

---

## Step 0 — Manual setup (you, ~15 min)

1. **Install the tools.**
   - Node.js LTS (20 or 22), Git and VS Code.
   - The Claude Code extension in VS Code. Or the CLI: `npm i -g @anthropic-ai/claude-code`, then run `claude` in the project folder.
2. **Create the project folder.** Example: `D:\Projects\drr-report-builder`. Open it in VS Code.
3. **Add the brief.** Put `CLAUDE.md` in the folder root.
4. **Add the build prompts.** Put this file at `docs/BUILD_PROMPTS.md`.
5. **Add the sample files.** Create `samples/2026-10/` and copy in the 8 October exports, plus `DRR Format.xlsx` and `Sponsor-wise Revenue Report.xlsx`.
   - If you have a **filled** October DRR and Sponsor-wise report, put them in `samples/2026-10/expected/`.
6. **Run `git init`.**
7. **Create the GitHub repo.**
   - The app code holds no patient data, so a public repo is fine for GitHub Pages.
   - A private repo needs a paid plan for Pages.

---

## Step 1 — Scaffold the app

```text
Read CLAUDE.md fully. Then scaffold the project in this folder:

- Vite + React + TypeScript (strict), Tailwind CSS, shadcn/ui (init + button, card, input, select, dialog, tabs, badge, table, toast/sonner, dropdown-menu, textarea, tooltip).
- Install: zustand, ag-grid-community, ag-grid-react, exceljs, zod, idb-keyval, jszip, and SheetJS from https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz. Dev: vitest, @types/wicg-file-system-access.
- Scripts: dev, build, preview, typecheck (tsc --noEmit), test (vitest run).
- vite.config base: './' so it works on GitHub Pages.
- .gitignore: node_modules, dist, samples/, *.xlsx except tests/fixtures/synthetic/**, .env*.
- Create the folder structure from CLAUDE.md with placeholder index files.
- App shell: left sidebar with pages Workspace, Sources, Doctors, Costs, Run, Months, Dashboards, Settings (simple tab state in Zustand, no router). Each page shows a title and an empty state.
- A header showing the current workspace folder name (or "No workspace selected").
- Show a clear message if the browser lacks window.showDirectoryPicker: "Please use Chrome or Edge".

Run typecheck, test and build. Then make the first commit.
```

**Check:** `npm run dev` shows the sidebar and pages.

---

## Step 2 — Profile the sample files (local only)

```text
Write scripts/profile-samples.ts (run with `npx tsx`) that reads every .xlsx in samples/2026-10/ with SheetJS. For each file and sheet it prints:
- dimensions
- the detected header row
- the header names
- 3 example rows, with values masked: replace letters in name/address/phone-like columns with x
- per numeric column: count, sum, blanks

Save the output to docs/source-profile.md (add docs/source-profile.md to .gitignore because it is derived from real data).

Then compare it with the "8 sources" table in CLAUDE.md and tell me about any differences in sheet names, header rows or column names.
```

**Check:** read `docs/source-profile.md`. The headers should match the table in `CLAUDE.md`.

---

## Step 3 — Core types, money and schemas

```text
Implement src/core/money.ts, types.ts, schemas.ts and measures.ts as described in CLAUDE.md.

- money.ts: toPaise(value: unknown): number | null (accepts numbers, strings with commas, ₹, Rs, spaces, (123) as negative); formatINR(paise) using en-IN grouping; sumPaise.
- types.ts: SourceId, SourceMapping (sheet, headerRow, namePattern, fields: Record<FieldKey, {type:'column'|'fixed'|'formula'|'none', value}>, rowFilter), DoctorMaster, MeasureRule, FactRow, CheckResult, RunInfo, CostEntry.
- schemas.ts: Zod schemas for every persisted JSON (sources, doctors, rules, costs, run-info, checks, dashboards placeholder), with a version field.
- measures.ts: a registry of the DRR and Sponsor-wise measures (code, label, kind: money|count|calc, DRR column header, Sponsor column header or null, calc formula for TOTAL_REVENUE and GROSS_PROFIT).
- src/core/defaults/rules.default.json with the default rules from CLAUDE.md.

Unit tests for money.ts (rounding, Indian formats, negatives, junk input → null) and for the schemas (valid/invalid). Run typecheck, test and build.
```

---

## Step 4 — Workspace folder storage + backup

```text
Implement src/storage/workspace.ts and backup.ts, plus the Workspace page.

- "Choose workspace folder" uses showDirectoryPicker({mode:'readwrite'}). Store the handle in IndexedDB via idb-keyval. On load, restore it and call requestPermission when needed (the button "Reconnect folder" appears when permission isn't granted).
- Create the workspace layout from CLAUDE.md if it's missing. Seed settings/rules.json from the defaults.
- Helpers: readJson(path, schema), writeJson(path, data) (write to a temp file then rename/overwrite), listDirs, writeFile(path, blob), readFile(path).
- Backup: zip the whole settings/ and data/ (not output/) into backup-YYYYMMDD-HHmm.zip and download it. Restore: pick a zip, validate every JSON with Zod, show a summary (what will be replaced) and ask for confirmation, then write.
- Workspace page: shows the folder name, months found, settings files present, and the Backup / Restore buttons.

Keep the File System Access calls behind a small interface so they can be mocked in tests. Unit-test the path and layout logic with a mock. Run typecheck, test and build.
```

**Check:** choose a test folder. The `settings/` and `data/` folders should appear in Windows Explorer.

---

## Step 5 — Excel reading in a worker

```text
Implement src/excel/readWorkbook.ts, detectHeader.ts and src/worker/ (start with a readFile task).

- Read a File with SheetJS (cellDates: true). Return sheet names, and for a chosen sheet the rows as arrays, aligned to real Excel row numbers (the range starts at A1).
- Read formula cells' cached values (e.g. "Net Amount" in OP Consultations).
- detectHeader: pick the row among the first 20 with the most non-numeric text cells. Make headers unique ("Column F" for blanks, "(2)" suffix for duplicates).
- SHA-256 fingerprint of the file bytes (crypto.subtle).
- Run reading inside the Web Worker. Show progress in the UI. The 12,586-row pharmacy file must not freeze the page.
- Identify the source for a file: first by namePattern (ignore month names, years and dates in the file name), then by best header overlap. Return a confidence value.

Unit tests with a small synthetic workbook generated in the test (title rows, header on row 3, a formula cell). Run typecheck, test and build.
```

---

## Step 6 — Formula engine

```text
Implement src/formula/ exactly as specified in CLAUDE.md:
- a tokenizer
- a recursive-descent parser to an AST
- a type-aware evaluator
- a function registry
- a validator that returns the referenced columns and a friendly error message with its position

Rules:
- Never use eval or Function.
- Leading "=" is optional; ";" is accepted as ",".
- [Column] lookup is exact, then case-insensitive, then an Excel column letter.
- Blank → 0 or "".
- Divide by zero throws FormulaError.
- IFERROR catches it.
- Comparisons between numbers are numeric; text comparisons are case-insensitive.
- IF, IFERROR, AND and OR evaluate lazily.

Write thorough unit tests (at least 40 cases), including:
- precedence, unary minus, %, & concatenation
- every function
- blanks, divide by zero, bad references, unknown functions, unclosed quotes and brackets

Run typecheck, test and build.
```

---

## Step 7 — Sources page (mapping)

```text
Build the Sources page using the reader (step 5) and formulas (step 6).

- A list of the 8 known sources (from CLAUDE.md) with their status: Not mapped / Ready / Flagged.
- Drop zone: drop one or many files. Each file is identified as a source (a confidence below 0.6 asks the user to pick).
- Mapping editor per source:
  - sheet select
  - header row (auto-detected, editable)
  - for each field the rules need: a dropdown of columns (with letters) | Fixed value | Formula | Not used
  - a formula input with live validation and clickable column chips that insert [Column]
  - an optional row filter formula
  - a namePattern field
- Preview: an AG Grid with the first 50 rows as the tool will read them (mapped fields only, money shown formatted). Unreadable cells are highlighted.
- Save to settings/sources.json.
- On a new file for an already-mapped source, re-apply the saved mapping. Show Ready, or Flagged with the exact missing columns. Never guess silently.
- Pre-fill the mappings with sensible defaults for the 8 sources, based on the key columns in CLAUDE.md, so the first setup is mostly "confirm".

Run typecheck, test and build.
```

**Check:** drop all 8 October files in. Each should show Ready after you confirm it.

---

## Step 8 — Doctor master

```text
Build src/core/doctors.ts and the Doctors page.

- normaliseName: trim, collapse spaces, upper-case, remove dots and commas, strip a leading "DR". Keep suffixes like "(REVIEW)" but flag them.
- From all loaded sources, collect raw doctor names with counts and the departments seen.
- Suggest groups by normalised name. The user can accept all, merge, split, rename the display name and set the default department (pre-selected as the most frequent).
- Save settings/doctors.json: { id, displayName, department, aliases[] }.
- Matching at run time: exact alias → normalised alias → unmatched. Unmatched names never create a doctor silently; they go to Checks.
- The same simpler mechanism applies to departments (canonical list + aliases) and sponsors (ORGANIZATIONNAME normalised, with optional grouping).

Unit tests for normalisation and matching. Run typecheck, test and build.
```

**Check:** the 84 raw October spellings should collapse to about 46 suggestions.

---

## Step 9 — Rules engine + pharmacy attribution

```text
Implement src/core/rules.ts and attribution.ts, and run them in the worker as task runMonth(month, files, settings).

- For each measure rule in rules.json: read the source rows using its mapping, apply the row filter, compute the value (formula or column) → paise, map doctor, department and sponsor, and emit a FactRow (see CLAUDE.md) with sourceFile, sourceRow and ref.
- Count measures emit 1 per row.
- Calc measures (TOTAL_REVENUE, GROSS_PROFIT) are computed at aggregate time, not per row.
- OP_PHARMACY = sales − returns (returns as negative rows), only where ADMNNO is empty.
- Pharmacy attribution exactly as in CLAUDE.md (Matched / Fallback / Unattributed + method).
- Strip all non-allowed columns. Patient names, phones and addresses must never reach FactRow.
- Track per source: rows read, used, filtered, skipped with reasons, and sums.
- aggregate.ts: group facts by doctor, department, sponsor and month into a pivot (measure columns), with calc measures applied.

Write unit tests with a synthetic dataset:
- 2 doctors, a patient with 2 consultations, a pharmacy bill with ADMNNO, a return, an unknown doctor, a bad amount
- assert the exact paise totals and attribution statuses

Run typecheck, test and build.
```

---

## Step 10 — Monthly costs page

```text
Build the Costs page.

- Month picker.
- An AG Grid with one row per doctor (from the master) and the columns Departmental Issues Cost, Salary Cost, Incentives, Professional Fee (₹, editable).
- "Copy from previous month" button.
- "Import from Excel": map columns like a source, matching doctors via the master.
- Operator name field (self-declared) and a note per change.
- Save to data/<month>/costs-draft.json. Validate the amounts.

Totals row at the bottom. Run typecheck, test and build.
```

---

## Step 11 — Checks

```text
Implement src/core/checks.ts with every Fail and Warning listed in CLAUDE.md.

- Each check returns: id, level (Pass/Warning/Fail), title, plain-language message, numbers (rows, amount) and a list of example rows (source file + row number + ref).
- Source tie-out: for each source, the total of the mapped value column after filters must equal the sum of that source's facts in the report (within ₹1).
- Doctor and department change vs the previous Final month: a warning when it moves more than 50% (threshold configurable in settings).
- A Final month requires zero Fails and a note on every Warning.

Unit tests for each check using the synthetic dataset. Run typecheck, test and build.
```

---

## Step 12 — Run page

```text
Build the Run page.

- Month picker (default: previous calendar month).
- Status of the 8 sources (Ready / Flagged / Missing) and the costs (Entered / Missing).
- "Run" button: executes runMonth in the worker with a progress bar.
- Results tabs:
  - Doctor-wise (AG Grid, the DRR columns, totals row)
  - Sponsor-wise
  - Checks (grouped by level, expandable rows, warning-note inputs)
  - Pharmacy attribution summary
- Save Draft → data/<month>/run-<n>/ with facts.json, costs.json, checks.json, settings-used.json and run-info.json (operator name, fingerprints).
- Mark Final (blocked while there are Fails; asks for missing warning notes). A Final run is read-only.
- Re-running a Final month creates run-<n+1> with a required reason.

Run typecheck, test and build.
```

**Check:** run October. Look through the Checks tab and the attribution split.

---

## Step 13 — Excel output from the templates

```text
Implement src/excel/fillTemplate.ts and escape.ts, plus "Download reports" on the Run page.

- Load templates from settings/templates/. The Settings page lets the user upload or replace the DRR and Sponsor-wise templates.
- Table fill, as in CLAUDE.md:
  - find the header row by header names
  - from the first data row, write S.No., the name columns, Month and every input measure column, matching by header text (case- and space-insensitive)
  - keep the template's formula columns (Total Revenue, Gross Profit) untouched
  - clear the values of unused pre-numbered rows but keep their formatting
  - if there are more data rows than pre-made rows, copy the last row's style and formula pattern down
- Write numbers as rupees (paise / 100) so the template number formats apply. Escape text via escape.ts.
- Add a "Checks" sheet: level, check, message, numbers, note.
- Add a "Data" sheet: fact rows without patient data.
- Output file names:
  - DRR_<YYYY-MM>_run<n>.xlsx
  - Sponsorwise_<YYYY-MM>_run<n>.xlsx
- Save both to output/<month>/ and offer them for download.
- Self-check: recompute Total Revenue and Gross Profit in TypeScript and compare with the template formula logic. A mismatch is a Fail.

Unit tests with a synthetic template (title rows, SUBTOTAL row, formulas in rows 5–10, 12 data rows → extends). Run typecheck, test and build.
```

**Check:** open the DRR in Excel. Formatting, the SUBTOTAL row and the formulas should all be intact.

---

## Step 14 — Golden and edge-case tests

```text
Add tests/golden/october.test.ts.

- If samples/2026-10/ exists, run the full pipeline on it with the committed default settings plus a local settings fixture at tests/golden/settings.local.json (git-ignored).
- If samples/2026-10/expected/ has a filled DRR / Sponsor-wise report, compare per doctor and per column, reporting the differences in a readable table (doctor, column, expected, actual, diff).
- If samples/ is missing (CI), skip with a clear message.

Add tests/fixtures/synthetic/: small made-up Excel files built by a script, scripts/make-fixtures.ts. They must cover:
- duplicate bill, OP return, unknown doctor
- patient with two consultations, ADMNNO pharmacy line
- unreadable amount, renamed column (must be Flagged), same file twice (must Fail)

Assert the expected Check results.

Run all tests. List any golden differences and what business rule each one points to. Do NOT change rules to force a match without asking me.
```

**Check:** read the list of differences. Answer the rule questions, update `rules.json` from the UI, and run again.

---

## Step 15 — Deploy to GitHub Pages

```text
Add .github/workflows/deploy.yml:
- on push to main: npm ci → typecheck → test → build → deploy dist/ to GitHub Pages (actions/upload-pages-artifact + actions/deploy-pages)
- pin action versions

Add a README with:
- what the tool does
- the Chrome/Edge requirement
- first-time setup
- the monthly steps
- backup/restore
- "never commit samples"

Then give me the exact git commands to create the remote and push, and the repo settings to enable Pages.
```

**Check:** open the Pages URL and choose the workspace folder. October should run exactly as it did locally.

---

# v2 — History and dashboards (after the October numbers are confirmed)

## Step 16 — Months, compare and trend

```text
Build the Months page.

- A table of months: latest run, status, Total Revenue, Gross Profit, Fails/Warnings, and buttons to re-download (regenerated from that run's settings-used.json, so the result is identical).
- Compare view:
  - Month A vs Month B (default latest Final vs previous)
  - level Doctor / Department / Sponsor
  - an AG Grid with A, B, Change, Change % for every measure
  - top 10 risers and fallers
  - export to Excel
- Trend view: pick a measure and a level; a 12-month ECharts line chart (install echarts and echarts-for-react now).
- "Import past DRR as summary month": read a filled DRR workbook into a summary-only run (no fact rows), so trends can start earlier.

Run typecheck, test and build.
```

---

## Step 17 — Dashboard builder

```text
Build the Dashboards page.

- A dashboard has a name, global filters (month range, department, sponsor) and tiles in a two-column grid (move up/down, no free drag).
- Tile editor:
  - type: KPI | bar | stacked bar | line | pie | table
  - X: Month | Doctor | Department | Sponsor
  - Y: any measure from the registry, with Sum / Count / Avg
  - optional split-by, filters, top N + sort
  - compare: none | previous month | same month last year
- All data comes from the saved Final runs via core/aggregate.ts and the measures registry. No separate calculations.
- Tile export: PNG (ECharts) and data to Excel.
- Save to settings/dashboards.json.
- Ship 5 starter dashboards: Revenue by source; Top 15 doctors by Gross Profit; Department trend; Sponsor mix; Month vs previous variance.
- "Monthly Review" opens on the latest Final month.

Run typecheck, test and build.
```

---

## Step 18 — Final review and polish

```text
Do a full review of the codebase against CLAUDE.md:
1. List every place a row could be dropped without appearing in Checks.
2. Confirm no patient name, phone or address can reach facts.json, the outputs or the backups. Grep the outputs of the October run to prove it.
3. Confirm money never sums floats.
4. Check the UI for empty states, error messages and loading states. Make sure keyboard use works on the main flows.
5. Run all tests and build.

Fix what you find, then give me a short report and a one-page user guide (docs/USER_GUIDE.md) for my two colleagues.
```
