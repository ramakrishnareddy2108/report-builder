# Synthetic fixtures

Small made-up Excel data for tests. **Never put real patient data here.**

Tests build their workbooks in memory with `tests/helpers/syntheticWorkbook.ts`
(HIS-shaped: two title rows, header on row 3). Add committed `.xlsx` files to this
folder only when a test needs a real file on disk, and keep them made-up.
