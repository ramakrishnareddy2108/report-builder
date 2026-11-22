# Design notes

Where the code adds to, or interprets, `CLAUDE.md`. Fold these into `CLAUDE.md` if you agree with them.

## Additions to the schemas (both optional, so nothing else changes)

| Where | Field | Why |
| --- | --- | --- |
| `SourceDef` | `uniqueColumn?: string` | "A duplicate-ID check must be configurable per source and off for line-item files." The schema had no field for it. Omit it to skip the check. |
| `ReportDef` | `excludeRowsWhere?`, `excludeLabel?`, `excludeAmountLabels?`, `excludeGroups?` | A formula on the combined rows, applied before grouping: matching rows are in no report row and no total. They are counted, with their amounts, in the Checks (`excludeLabel`, `excludeAmountLabels` and `excludeGroups` only shape that line), and the tie-outs add them back. |
| `SourceDef` | `leftOutNote?: { title, amountColumn? }` | Rows the row filter leaves out on purpose (pharmacy to admitted patients) are counted with their amount, shown as one info line. Sources with the same title are added together. |
| `SourceDef` | `missingWarning?: string` | Only for an optional source: a warning (not an info line) when no file is added, with this text. |
| `TieOut` | `alsoSources?`, `totalFrom?: 'footer' \| 'rows'`, `level?: 'warning' \| 'error'` | OP Pharmacy + OP Returns are one tie-out; the pharmacy files have no total row, so the total is the sum of the rows read; a mismatch of the pharmacy tie-out is an Error. |
| `Tile` | `extraY?: { column, agg }[]` | The starter "stacked bar: Department × revenue columns" needs several measures as series. `y` + `splitBy` cannot draw several columns per category. |

## Interpretations

- **Formulas see rupees.** Money is stored as integer paise, but a formula (row filter, calculated column, report formula,
  `where`) reads it as rupees, so `[Gross]-[Discount]` and `ROUND([Amount]*0.18, 2)` mean what they say. A formula that gives a
  money value is turned back into paise (which also removes binary noise). Dashboard sums are also done in paise.
- **Report sort.** With no `sort` in the recipe, rows are A–Z by the group-by columns, so the report reads the same every month.
  An explicit empty `sort: []` keeps data order.
- **Totals row.** Built from all rows with the same aggregates (so COUNTDISTINCT / AVG / MIN / MAX are right too), formula
  columns recomputed. In template mode no totals row is written (the template has its own SUBTOTALs).
- **Files that match no source do not block Generate** (the IP Admissions export is in the monthly set but not used by the
  starter recipes). They are listed in the Checks as *Files not used*. A file that could be **two** sources, or two files for one
  source, does block until the user chooses.
- **Starter recipes ship without a template.** Generate asks for it once and stores it in the recipe. A template that already
  holds data is refused (it would store names and amounts in the recipe and the exported library).
- **Autosave vs Save.** The builder saves a draft to the library as you work (never lose work). *Save recipe* confirms the
  recipe is complete (no definition errors) and returns to Home. Home marks unfinished recipes.
- **PWA without a library.** Hand-written service worker plus a 30-line Vite plugin, because the stack rule says not to add
  libraries without asking. See the README.
- **Golden test.** `tests/golden/drr.test.ts` prints totals and compares with a filled DRR when one is in
  `samples/2026-10/expected/`. It asserts only rule-independent facts.

- **Lookup ties are `Ambiguous`.** For pick `latestOnOrBefore`, the dates are compared as calendar days (IST). If the chosen day
  has more than one *different* value (for example two consultations on one day, two doctors), the row is `Ambiguous`, not
  `Matched`; `Matched` means exactly one value on that day. The optional `tieBreak` decides what is written
  (`preferNotMatching` with a formula over the lookup rows, then `first` or `unattributed`; no tie-break = first in the file).
  The row stays `Ambiguous` either way, and the Checks show the count and amount. The default formula uses the formula
  language's `AND(...)` function, since the language has no infix `AND`.
- **Cleanup steps.** `dotsToSpace`, `stripDrPrefix` and `stripSuffix` are optional on a cleanup rule (rules saved earlier keep
  their old behaviour). A strip never leaves a name empty. `removeChars` still removes characters without a space.
- **`report.hideZeroRows`.** A row whose aggregate columns are all 0 or blank is left out of the report and listed in the Checks
  (up to 300 rows). The totals row still counts every combined row.

- **Tie-outs compare a source with its share of the report.** For a Total (aggregate) report column the report side is what
  *those sources* added to the column (`ReportResult.sourceShares`), plus what the exclusion left out (`excludedShares`), so
  `OP Revenue` (billing + consultations) can have one tie-out per source, and `OP Pharmacy` compares
  *source total = report + excluded*. For a formula column the whole column is compared, as before. The source side is the
  grand-total row at the end of the file, or (`totalFrom: 'rows'`) the sum of the rows read, counted before the combine so it also
  proves nothing was lost on the way. Tolerance is in rupees.
- **Checks wording.** The two requested lines are the check *title* plus its message, e.g. title
  `Excluded from report: unattributed OP pharmacy`, message `3,427 lines, sales ₹…, cost ₹…`. The amounts use the report column
  names unless `excludeAmountLabels` renames them ("OP Pharmacy" → "sales").
- **Spelling merges change a doctor's figure.** Stripping " (REVIEW)" merges `BALA KRISHNA SANAMPUDI (REVIEW)` (one OP Billing row of
  ₹500) into `BALA KRISHNA SANAMPUDI`, so his OP Revenue is ₹2,91,404.50, not the ₹2,90,904.50 of a hand count that uses the
  plain spelling only. The golden test pins both numbers.

## Not verified in a browser

The UI was built and type-checked, and all logic is covered by tests, but it was **not exercised in a real browser session**
by the person who wrote it (no browser tool was available). Please click through the main flow once on a laptop and once
on a phone.

## Open business questions (from the real October 2026 files, unchanged)

1. **Pharmacy attribution.** *Decided for the DRR: unattributed pharmacy is left out of the report and listed in Checks.* About half the OP pharmacy rows (3,419 of 6,568) have no consultation to take a doctor from, and
   2,503 of them have no UMR number at all. Should OP Billing be a second source for attribution?
2. **Repeated consultation number.** OP Consultations has one repeated number (2 rows). A real duplicate, or switch the check off?
3. **PENDING IP bills** are included in IP Revenue (about ₹1.77 Cr of ₹3.97 Cr). Confirm.
4. ~~OP Consultations in OP Revenue~~ — **decided by finance: included** (OP Revenue = OP Billing + OP Consultations). Note that
   1,187 patient-days appear in both files; finance accepted adding them.
5. **Costs file.** The Costs sheet has no Department, so a doctor's costs form their own row (blank department) next to the
   doctor's revenue row. Add a Department column to the Costs sheet, or group costs another way.
6. **IP Count** counts IP Discharge rows (499 in October). Confirm against a filled DRR.
7. **Generic "doctors" in the consultation file.** The default tie-break formula skips names containing "Consultation" or
   "Check Up", but October also has "Nephrologist Consultant Charges" (written as the doctor on about 52 ambiguous pharmacy
   rows). Add `NOT(CONTAINS([Doctor],"Consultant"))` to the formula in Prepare if that is not a real doctor.
