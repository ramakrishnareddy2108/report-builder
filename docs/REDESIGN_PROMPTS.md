# Redesign prompts for Claude Code — recipe design

Paste these one at a time, in order. For each step:

1. Use **Plan mode** first (`Shift+Tab`) and read the plan.
2. Approve it.
3. Test with `npm run dev`.
4. Commit.

If a step drifts, use `/clear` and paste it again; `CLAUDE.md` holds the context.

---

## Step 0 — Prepare (you, 5 min)

1. Commit your current work, then create a branch: `git checkout -b recipe-redesign`.
2. Rename your current `CLAUDE.md` to `docs/CLAUDE.old.md`, for reference.
3. Put the new `CLAUDE.md` in the project root.
4. Put this file at `docs/REDESIGN_PROMPTS.md`.
5. Keep `samples/2026-10/` as it is: it's git-ignored and used for local tests.

---

## Step R1 — Audit and plan the refactor

```text
Read CLAUDE.md (new design) and docs/CLAUDE.old.md (old design). Then audit the codebase and produce docs/REFACTOR_PLAN.md listing:
- KEEP as is (expected: excel/readWorkbook, detectHeader, fillTemplate, escape; formula engine; money helpers; worker setup; UI components; deploy workflow)
- MOVE/RENAME into the new folders (recipe/, engine/, dashboard/)
- DELETE (expected: workspace folder storage, doctors master, costs page, months/runs, measures registry, rules.json, Final locking, JSZip backup)
- NEW modules to write

Note any facts in the old code (e.g. text-date parsing, IST dates, duplicate headers, footer rows) that must be preserved.

Do not change code yet. Show me the plan.
```

**Check:** read `REFACTOR_PLAN.md`. Push back on anything that should be kept.

---

## Step R2 — Remove the old design, new app shell

```text
Execute the DELETE and MOVE parts of docs/REFACTOR_PLAN.md:
- Remove the Workspace, Sources, Doctors, Costs, Run, Months and Settings pages, plus their stores and storage code.
- Remove the File System Access dependency and the Chrome/Edge-only check.
- New sidebar pages: Home, Recipe builder (only reachable from Home), Generate, Dashboards, Help. Each has an empty state.
- Keep every reusable module (excel/, formula/, money, worker plumbing).
- The app must build and run with no dead imports.

Remove unused dependencies (jszip, @types/wicg-file-system-access) from package.json.

Run typecheck, test and build. Fix or delete tests that only covered removed code. Commit.
```

---

## Step R3 — Recipe schema + library

```text
Implement src/recipe/schema.ts (Zod, exactly the types in CLAUDE.md) and src/recipe/library.ts:
- IndexedDB via idb-keyval: list / get / save / delete / duplicate recipes and dashboard templates.
- Export library → one JSON file { schemaVersion, exportedAt, recipes[], dashboards[] } downloaded as report-library-YYYYMMDD.json.
- Import library → validate with Zod and show a summary (new / will overwrite / invalid). Options: Merge (default) or Replace all.
- An "Unsaved to file" flag in Zustand: set on any change, cleared after export. Show the badge in the header.

Home page:
- Recipes list (name, sources count, updated) with New, Open, Duplicate, Delete, and "Generate" shortcut
- Dashboards list
- Export / Import buttons

Unit tests for schema validation and import merge logic. Run typecheck, test and build.
```

---

## Step R4 — Formula additions + source reading upgrades

```text
Extend src/formula/ with TEXT(date, "YYYY-MM" | "MMM-YYYY" | "DD-MM-YYYY"), PARAM(name) (the evaluator takes a params map) and STARTSWITH(text, prefix).

Upgrade the reading layer so it follows "Reading rules every source needs" in CLAUDE.md:
- unique headers for duplicates ("NAME (2)")
- column-letter references in columns.from and formulas
- date parsing (Excel dates in Asia/Kolkata; DD-MON-YYYY, DD-MM-YYYY and ISO text)
- cached values for formula cells
- 'money' type → integer paise; unreadable → blank + counted

Reuse existing code where it already does this.

Unit tests for every new function and each reading rule, with synthetic workbooks (duplicate header, text dates, footer total row, formula cell). Run typecheck, test and build.
```

---

## Step R5 — Engine: sources → combined table

```text
Implement src/engine/assignFiles.ts, readSource.ts and combine.ts per the "Engine pipeline" steps 1–5 in CLAUDE.md:
- assignFiles(files, recipe) → { assignments, unassignedFiles, missingRequiredSources, ambiguous }
- readSource(file, sourceDef, params) → { rows, stats: { read, filtered, used, unreadableByColumn }, errors: [{ level: 'error', message }] }
  - A missing column or missing formula reference is a blocking error with a plain message naming the source and column.
- combine(sourceResults) → combined table with Source, _file, _row and the parameter columns.

Pure functions, run through the worker (task: 'combine').

Unit tests with 2–3 synthetic sources that have different columns. Run typecheck, test and build.
```

---

## Step R6 — Engine: cleanup, lookups, report, checks, output

```text
Implement src/engine/cleanup.ts, lookups.ts, report.ts, checks.ts and output.ts per CLAUDE.md (pipeline steps 6–10):
- cleanup: normalise + aliases; return the mapping raw → clean and the counts.
- lookups:
  - pick single / latestOnOrBefore / first, with the date comparison on calendar dates
  - onlyWhen filter, notFoundValue, status column (Matched / Fallback / Unattributed)
  - extraValues (e.g. also bring Department)
- report:
  - groupBy, aggregates with `where` formulas (evaluate once per combined row; group efficiently with a Map)
  - money sums in paise
  - formula columns over the same report row
  - serial, sort, totals row (formula columns recomputed on totals)
- checks:
  - per-source stats
  - lookup status counts and amounts
  - tie-outs with tolerance
  - unmatched / leftover names after cleanup
  - levels Error / Warning / Info
- output:
  - plain mode (one sheet + optional Checks and Combined sheets)
  - template mode via the existing fillTemplate (keepTemplateFormulas + the formula cross-check)
  - escape text

Add engine/generate.ts that runs the whole pipeline and returns { report, combined, checks, workbookBlob }, and expose it in the worker with progress events.

Unit tests:
- a synthetic end-to-end recipe (2 doctors, name variants, a patient with 2 consultations, a pharmacy row without a match, a return, an IP row filtered out, a footer row)
- assert exact paise totals, statuses and check counts

Run typecheck, test and build.
```

---

## Step R7 — Recipe builder: 1 Sources

```text
Build the Recipe builder page with tabs 1 Sources · 2 Prepare · 3 Report · 4 Output · 5 Test & Save, plus recipe name, description and parameters (e.g. Month) at the top. This step is tab 1:

- "Upload sample files": drop many files.
- For each file, create or choose a source: label, required flag, sheet picker (by name), header row (auto + editable).
- An AG Grid preview of the first 50 raw rows.
- Column picker:
  - checkbox per header (with its letter)
  - "Save as" name with autocomplete from names used in other sources, so stacking aligns
  - type (text / number / money / date)
- Row filter formula input with live validation and clickable column chips.
- Calculated columns list (as, formula, type) with validation.
- match.requiredHeaders auto-filled from the picked columns (editable); namePattern from the file name with dates removed.
- "Combined preview" button: runs combine in the worker, shows the combined table (AG Grid, first 200 rows) and the per-source stats. "Download combined Excel".

Autosave the draft recipe to IndexedDB. Run typecheck, test and build.
```

---

## Step R8 — Recipe builder: 2 Prepare, 3 Report

```text
Tab 2 Prepare:
- Cleanup rules:
  - pick a combined column (e.g. Doctor)
  - normalise options and display case
  - a live table of raw values → cleaned value with counts
  - "Merge" to add aliases (multi-select values → one name)
  - a list of suspicious near-duplicates (same name without spaces/dots, or one name containing the other) to review
- Lookups:
  - form for target source/column/key/date, from source/key/value/date, extraValues, onlyWhen, pick, notFoundValue, status column
  - a live result summary (Matched / Fallback / Unattributed counts + amounts)

Tab 3 Report:
- Group by: ordered multi-select of combined columns.
- Columns: an ordered list. Add Group / Aggregate / Formula / Serial.
  - Aggregate: agg, of, where (formula with chips; quick-pick for [Source]="…"), type.
  - Formula columns: chips for the other report columns.
- Sort and totals row.
- Live preview: an AG Grid of the report built from the sample files, with the totals row.

Run typecheck, test and build.
```

---

## Step R9 — Recipe builder: 4 Output, 5 Test & Save

```text
Tab 4 Output:
- Mode plain / template.
- Template mode:
  - upload the template (store it as base64 in the recipe; warn above 2 MB)
  - pick the sheet, header row (auto)
  - a column-matching table: report column → template header, with matched / unmatched / formula-kept status
  - keepTemplateFormulas toggle
  - include Checks / Combined sheet toggles

Tab 5 Test & Save:
- "Run test" on the sample files with parameter values.
- Show the checks (Error / Warning / Info, expandable to rows with file + Excel row).
- Download the test output.
- "Save recipe" is disabled while there are Error-level problems in the recipe definition itself (invalid formulas, a missing output mapping); data errors don't block saving.

Run typecheck, test and build.
```

---

## Step R10 — Generate page (the everyday flow)

```text
Build the Generate page:
1. Pick a recipe (or arrive from Home).
2. Drop this month's files. The page shows a source checklist: each source → assigned file / missing (required or optional). Unassigned files can be assigned manually.
3. Parameter inputs (e.g. Month, defaulting to the previous calendar month as "MMM-YYYY").
4. "Generate" → worker progress →
   - Checks panel: Errors block the download and show what to fix, e.g. "OP Billing: NETAMOUNT not found — open recipe → Sources".
   - Warnings and Info are listed with counts and amounts.
   - Report preview grid.
5. "Download report" (file name: <RecipeName>_<Month>.xlsx) and optionally "Download combined data".
6. "Open in dashboard": sends this report's rows to the Dashboards page in memory.

When a column is missing, offer a "Fix mapping" shortcut that opens the recipe at that source with the new file loaded as its sample.

Run typecheck, test and build.
```

**Check:** generate October in 3 clicks after picking the recipe.

---

## Step R11 — Default DRR and Sponsor-wise recipes + golden test

```text
Create src/recipe/defaults/drr.recipe.json and sponsorwise.recipe.json exactly as described in CLAUDE.md ("Default DRR recipe", "DRR template", "Sponsor-wise recipe").

The template files are not committed. The recipe has output.mode 'template' with an empty templateBase64, and the UI asks for the template on first use.

On first launch (empty library) offer "Add starter recipes: DRR, Sponsor-wise".

tests/golden/drr.test.ts: if samples/2026-10/ exists, load the default DRR recipe plus the local templates from samples/, generate with Month = "Oct-2026" and:
- print the report totals per column and the checks summary
- if samples/2026-10/expected/ has a filled DRR, compare per doctor and per column and print the differences table
- skip with a clear message when samples/ is absent (CI)

Do NOT change rules to force a match. List the differences and which business rule each one points to.

Run all tests and build.
```

---

## Step R12 — Dashboards on report outputs

```text
Build the Dashboards page per the dashboard schema in CLAUDE.md:

Load data (top bar):
- "From last generated report" (in memory)
- "Upload report files": one or many saved outputs
  - read the header row (auto, or from the linked recipe's output settings)
  - skip the SUBTOTAL row and blank rows
  - stack the files with _file
  - if there is no Month column, use the file name as the period

Template picker:
- New / Open / Save / Duplicate.
- requiredColumns validated against the loaded data, with a clear message on mismatch.

Global filters: chosen columns become dropdowns (multi-select).

Tiles (2-column grid, reorder up/down, edit, delete):
- Editor: type, title, X, Y (column + agg), splitBy, filter formula, topN, sort, and compare by a period column (previous period: change and change %).
- Rendered with ECharts. Table tiles use AG Grid.
- Per-tile menu: PNG export and data to Excel.

Starter template "DRR Monthly Review" (linked to the DRR recipe):
- KPI Total Revenue
- KPI Gross Profit
- bar: Top 15 doctors by Gross Profit
- stacked bar: Department × revenue columns
- line: Total Revenue by Month (useful when 2+ months are uploaded)
- table: Month vs previous variance by Doctor

Run typecheck, test and build.
```

**Check:** upload 2 DRR outputs (e.g. the October output twice, with Month edited to Sep-2026 in one copy). The comparison tiles should show changes.

---

## Step R13 — Help, polish, deploy

```text
1. Help page:
   - 5-step quick start (create a recipe, generate, dashboards, export the library, share with a colleague)
   - the formula reference with examples (filters on multiple columns, conditional sums, TEXT dates)
2. Review against CLAUDE.md principles:
   - no data persisted except recipes/dashboards (inspect IndexedDB)
   - no silent row drops
   - paise sums
   - Excel escaping
   Fix any gaps.
3. Empty states, loading states and plain-language errors on every page. Make sure keyboard use works on the main flow.
4. Update the README and docs/USER_GUIDE.md for the recipe flow.
5. Run all tests and build. Merge to main only after I confirm. The existing GitHub Actions deploy then publishes it.
```
