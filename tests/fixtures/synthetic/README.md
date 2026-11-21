# Synthetic fixtures

Small made-up Excel files for tests. **Never put real patient data here.**

They are written by `scripts/make-fixtures.ts` from `tests/helpers/monthData.ts`:

```
npx tsx scripts/make-fixtures.ts
```

| Folder | What it holds |
|---|---|
| `base/` | The 8 exports of a made-up October 2026: 2 doctors and one unknown, a patient with two consultations, OP pharmacy with an in-patient line, an OP return, an unreadable amount, a bill dated outside the month, grand-total rows |
| `duplicate-bill/` | OP Billing with one bill number repeated (the check **Fails**) |
| `renamed-column/` | OP Billing whose `NETAMOUNT` column was renamed (the source is **Flagged**) |
| `same-file-twice/` | A byte-identical second copy of OP Billing (the check **Fails**) |

`tests/unit/syntheticFixtures.test.ts` puts the files of a scenario over `base/` and asserts the Checks.
Change the data in `monthData.ts`, run the script, and commit the new files together.
