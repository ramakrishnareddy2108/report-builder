/**
 * Writes the small made-up Excel files in tests/fixtures/synthetic/.
 *
 *   npx tsx scripts/make-fixtures.ts
 *
 * The data comes from tests/helpers/monthData.ts (no real patient data). Folders:
 *   base/              the 8 exports of a made-up October 2026
 *   duplicate-bill/    OP Billing with one bill number repeated
 *   renamed-column/    OP Billing whose NETAMOUNT column was renamed (must be Flagged)
 *   same-file-twice/   a byte-identical second copy of OP Billing (must Fail)
 * The test overlays the files of a scenario folder on base/.
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SourceId } from '../src/core/types';
import { MONTH_DATA, type SourceData } from '../tests/helpers/monthData';
import { buildWorkbook, hisSheet } from '../tests/helpers/syntheticWorkbook';

const OUT = 'tests/fixtures/synthetic';

function write(dir: string, source: SourceData, edit: (s: SourceData) => SourceData = (s) => s): string {
  const s = edit(source);
  mkdirSync(join(OUT, dir), { recursive: true });
  const path = join(OUT, dir, s.fileName);
  writeFileSync(path, buildWorkbook({ [s.sheet]: hisSheet(s.header, s.rows) }));
  return path;
}

// base: all 8 sources.
for (const id of Object.keys(MONTH_DATA) as SourceId[]) write('base', MONTH_DATA[id]);

const billing = MONTH_DATA.opBilling;

// duplicate-bill: B1 appears twice (the grand-total row stays last).
write('duplicate-bill', billing, (s) => ({ ...s, rows: [s.rows[0] as SourceData['rows'][number], s.rows[0] as SourceData['rows'][number], ...s.rows.slice(1)] }));

// renamed-column: NETAMOUNT -> NET_AMT.
write('renamed-column', billing, (s) => ({ ...s, header: s.header.map((h) => (h === 'NETAMOUNT' ? 'NET_AMT' : h)) }));

// same-file-twice: an identical copy under another name, as when a file is dropped twice.
mkdirSync(join(OUT, 'same-file-twice'), { recursive: true });
copyFileSync(join(OUT, 'base', billing.fileName), join(OUT, 'same-file-twice', billing.fileName.replace('.xlsx', ' (1).xlsx')));

console.log(`Wrote the fixtures in ${OUT}/`);
