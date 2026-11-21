# Golden tests

These read the **real** hospital files in `samples/2026-10/` (git-ignored). When `samples/` is missing,
for example in CI, they are skipped and say so in the log.

| File | What it checks |
|---|---|
| `readSamples.test.ts` | each export is identified, with its sheet and header row |
| `defaultMappings.test.ts` | the default mappings fit the real files; every row is accounted for |
| `doctors.test.ts` | the doctor names collapse to a few dozen suggestions |
| `october.test.ts` | the whole run on October: rows, sums and checks (prints counts and totals only) |
| `templates.test.ts` | the real DRR / Sponsor-wise templates pass the self-check and fill correctly |
| `expected.test.ts` | the tool's reports against a **filled** DRR / Sponsor-wise in `samples/2026-10/expected/` |

`expected.test.ts` compares every row and column and prints the differences as a table
(name, column, expected, actual, diff). It does nothing until a filled report is placed in
`samples/2026-10/expected/` (an empty template is detected and skipped). A difference usually
points at a business rule: **do not change a rule only to make a number match; ask first.**

## Local settings (optional)

`tests/golden/settings.local.json` (git-ignored, it may name real doctors) adjusts the golden run:

```json
{
  "flags": { "includePendingIpBills": true, "includeConsultations": false },
  "rules": [],
  "costs": { "Doctor name as in the doctor list": { "SALARY": 150000, "INCENTIVES": 5000 } }
}
```

`rules` replaces the whole measure-rule list (leave it out to keep the defaults), and `costs` are in rupees.
