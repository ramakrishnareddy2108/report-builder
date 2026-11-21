# Golden tests

These read the **real** hospital files in `samples/2026-10/` (git-ignored, patient data never goes into git).
When `samples/` is missing, for example in CI, they skip themselves and say so in the log.

| File | What it checks |
|---|---|
| `drr.test.ts` | The starter **DRR** and **Sponsor-wise** recipes on October 2026: every source is found and read, `read = left out + used` for each source, the combined table holds every used row, the report totals equal the sum of the rows, no Error-level check. It also **prints** the source counts, lookup results, check summary and report totals. |

## Look at the numbers

```bash
npx vitest run tests/golden/drr.test.ts --silent=false
```

## Compare with a filled report

Put a **filled** October DRR in `samples/2026-10/expected/DRR Format.xlsx`. The test then compares every doctor
and column and prints a table of differences. An empty template is detected and skipped.

A difference is not a failure. It usually points at a business rule to confirm with the finance team.
**Do not change a rule only to make a number match; ask first.**

## Templates

The DRR template is read from `samples/2026-10/expected/DRR Format.xlsx` and the Sponsor-wise template from
`samples/2026-10/Sponsor-wise Revenue Report.xlsx`. Neither is committed: the starter recipes ship with an empty
template and the app asks for it on first use.
