# Design notes

Where the code adds to, or interprets, `CLAUDE.md`. Fold these into `CLAUDE.md` if you agree with them.

## Additions to the schemas (both optional, so nothing else changes)

| Where | Field | Why |
| --- | --- | --- |
| `SourceDef` | `uniqueColumn?: string` | "A duplicate-ID check must be configurable per source and off for line-item files." The schema had no field for it. Omit it to skip the check. |
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

## Not verified in a browser

The UI was built and type-checked, and all logic is covered by tests, but it was **not exercised in a real browser session**
by the person who wrote it (no browser tool was available). Please click through the main flow once on a laptop and once
on a phone.

## Open business questions (from the real October 2026 files, unchanged)

1. **Pharmacy attribution.** About half the OP pharmacy rows (3,419 of 6,568) have no consultation to take a doctor from, and
   2,503 of them have no UMR number at all. Should OP Billing be a second source for attribution?
2. **Repeated consultation number.** OP Consultations has one repeated number (2 rows). A real duplicate, or switch the check off?
3. **PENDING IP bills** are included in IP Revenue (about ₹1.77 Cr of ₹3.97 Cr). Confirm.
4. **OP Consultations in OP Revenue** is off (1,187 patient-days appear in both OP Billing and OP Consultations). Confirm.
5. **Costs file.** The Costs sheet has no Department, so a doctor's costs form their own row (blank department) next to the
   doctor's revenue row. Add a Department column to the Costs sheet, or group costs another way.
6. **IP Count** counts IP Discharge rows (499 in October). Confirm against a filled DRR.
