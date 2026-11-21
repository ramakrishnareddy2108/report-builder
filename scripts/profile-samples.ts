/**
 * Profiles the real HIS exports in samples/<month>/ and writes docs/source-profile.md.
 *
 *   npx tsx scripts/profile-samples.ts [samples/2026-10] [docs/source-profile.md]
 *
 * The output is derived from real patient data, so it is git-ignored.
 * Example rows are masked: in name/address/phone-like columns letters become "x"
 * (and digits become "9" in phone-like columns). Doctor, department and sponsor
 * names are not masked — they are business data we keep anyway.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import * as XLSX from 'xlsx';

type Cell = string | number | boolean | Date | null;
type Row = Cell[];

const SAMPLE_DIR = process.argv[2] ?? 'samples/2026-10';
const OUT_FILE = process.argv[3] ?? 'docs/source-profile.md';
const HEADER_SCAN_ROWS = 15;
const EXAMPLE_ROWS = 3;

// ---------- masking ----------

const SENSITIVE_HEADER = /name|patient|addr|phone|mobile|contact|email|relation|guardian|father|mother|husband|spouse|attendant|kin|street|city|area|village|pin ?code|aadha?r|pan\b/i;
const BUSINESS_HEADER = /doctor|dr\.?\s?name|consultant|department|dept|organi[sz]ation|org\s?name|sponsor|company|payor|payer|insurance|tpa|service|item|ward|bed|user|unit|specialit|referr/i;
const PHONE_HEADER = /phone|mobile|contact|cell/i;
const PHONE_VALUE = /^\+?(91)?[6-9]\d{9}$/;

type MaskKind = 'none' | 'letters' | 'phone';

function maskKindFor(header: string, values: Cell[]): MaskKind {
  if (PHONE_HEADER.test(header)) return 'phone';
  const nonBlank = values.filter((v) => !isBlank(v));
  if (nonBlank.length > 0) {
    const phoneLike = nonBlank.filter((v) => PHONE_VALUE.test(String(v).replace(/[\s-]/g, ''))).length;
    if (phoneLike / nonBlank.length > 0.5) return 'phone';
  }
  if (SENSITIVE_HEADER.test(header) && !BUSINESS_HEADER.test(header)) return 'letters';
  return 'none';
}

function mask(v: Cell, kind: MaskKind): string {
  const s = fmtCell(v);
  if (kind === 'letters') return s.replace(/\p{L}/gu, 'x');
  if (kind === 'phone') return s.replace(/\p{L}/gu, 'x').replace(/\d/g, '9');
  return s;
}

// ---------- helpers ----------

function isBlank(v: Cell | undefined): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function fmtCell(v: Cell | undefined): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().replace('T00:00:00.000Z', '');
  return String(v);
}

function md(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function toPaise(n: number): number {
  return Math.round(n * 100);
}

function fmtPaise(p: number): string {
  const neg = p < 0;
  const abs = Math.abs(p);
  const rupees = Math.floor(abs / 100).toLocaleString('en-IN');
  const paise = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}${rupees}.${paise}`;
}

/** Header = the row in the first N rows with the most non-blank text cells (ties → earliest). */
function detectHeader(rows: Row[]): number {
  let best = -1;
  let bestScore = 0;
  for (let r = 0; r < Math.min(rows.length, HEADER_SCAN_ROWS); r++) {
    const row = rows[r] ?? [];
    const texts = row.filter((c) => typeof c === 'string' && c.trim() !== '');
    const numbers = row.filter((c) => typeof c === 'number').length;
    const score = texts.length - numbers;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

// ---------- profiling ----------

function profileSheet(sheetName: string, ws: XLSX.WorkSheet, sheetIndex: number): string[] {
  const out: string[] = [];
  const ref = ws['!ref'] ?? '(empty)';
  out.push(`### Sheet ${sheetIndex + 1}: \`${sheetName}\``, '');
  out.push(`- Dimensions (\`!ref\`): \`${ref}\``);

  const rows = XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: true, defval: null, blankrows: true });
  if (rows.length === 0) {
    out.push('- Sheet is empty.', '');
    return out;
  }
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
  const firstRowNo = range.s.r + 1; // Excel row number of rows[0]

  const h = detectHeader(rows);
  if (h < 0) {
    out.push('- No header row detected.', '');
    return out;
  }
  const headerRow = rows[h] ?? [];
  const width = Math.max(headerRow.length, ...rows.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => fmtCell(headerRow[i]).trim());
  const colLetter = (i: number) => XLSX.utils.encode_col(range.s.c + i);

  out.push(`- Detected header row: **${firstRowNo + h}**`);
  for (let r = 0; r < h; r++) {
    const title = (rows[r] ?? []).filter((c) => !isBlank(c)).map(fmtCell).join(' · ');
    out.push(`- Row ${firstRowNo + r} (above header): ${title ? `\`${md(title)}\`` : '(blank)'}`);
  }

  const data = rows.slice(h + 1);
  const dataIdx = data.map((r, i) => ({ r, excelRow: firstRowNo + h + 1 + i })).filter(({ r }) => r.some((c) => !isBlank(c)));
  const blankRows = data.length - dataIdx.length;
  const totalLike = dataIdx.filter(({ r }) => r.some((c) => typeof c === 'string' && /\btotal\b/i.test(c)));
  out.push(`- Data rows (non-blank, below header): **${dataIdx.length}**${blankRows ? ` (plus ${blankRows} blank rows)` : ''}`);
  if (totalLike.length) {
    out.push(`- Rows containing the word "total": ${totalLike.map((t) => t.excelRow).join(', ')}`);
  }
  out.push('');

  // columns
  const columns = headers.map((name, i) => {
    const values = dataIdx.map(({ r }) => r[i] ?? null);
    const nonBlank = values.filter((v) => !isBlank(v));
    const nums = nonBlank.filter((v): v is number => typeof v === 'number');
    const dates = nonBlank.filter((v) => v instanceof Date).length;
    const isNumeric = nonBlank.length > 0 && nums.length / nonBlank.length >= 0.8;
    return {
      i,
      name,
      values,
      blanks: values.length - nonBlank.length,
      nums,
      dates,
      nonNumeric: nonBlank.length - nums.length,
      isNumeric,
      maskKind: maskKindFor(name, values),
    };
  });

  out.push('**Headers**', '');
  out.push('| Col | Header | Type | Blanks | Masked |', '|---|---|---|---|---|');
  for (const c of columns) {
    const type = c.isNumeric ? 'number' : c.dates > 0 && c.dates >= (c.values.length - c.blanks) * 0.8 ? 'date' : c.values.length === c.blanks ? 'empty' : 'text';
    out.push(`| ${colLetter(c.i)} | ${c.name ? `\`${md(c.name)}\`` : '_(blank)_'} | ${type} | ${c.blanks} | ${c.maskKind === 'none' ? '' : c.maskKind} |`);
  }
  out.push('');

  // examples
  const examples = dataIdx.slice(0, EXAMPLE_ROWS);
  if (examples.length) {
    out.push(`**Example rows (masked)**`, '');
    out.push(`| Row | ${columns.map((c) => md(c.name || colLetter(c.i))).join(' | ')} |`);
    out.push(`|---|${columns.map(() => '---').join('|')}|`);
    for (const { r, excelRow } of examples) {
      out.push(`| ${excelRow} | ${columns.map((c) => md(mask(r[c.i] ?? null, c.maskKind))).join(' | ')} |`);
    }
    out.push('');
  }

  // numeric stats
  const numeric = columns.filter((c) => c.isNumeric);
  if (numeric.length) {
    out.push('**Numeric columns** (sum computed in paise, rounded per cell)', '');
    out.push('| Col | Header | Count | Sum | Blanks | Non-numeric |', '|---|---|---|---|---|---|');
    for (const c of numeric) {
      const sum = c.nums.reduce((acc, n) => acc + toPaise(n), 0);
      out.push(`| ${colLetter(c.i)} | \`${md(c.name)}\` | ${c.nums.length} | ${fmtPaise(sum)} | ${c.blanks} | ${c.nonNumeric} |`);
    }
    out.push('');
  }

  return out;
}

function main(): void {
  const files = readdirSync(SAMPLE_DIR)
    .filter((f) => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'))
    .sort((a, b) => a.localeCompare(b));

  const out: string[] = [
    '# Source profile',
    '',
    `> Generated by \`scripts/profile-samples.ts\` from \`${SAMPLE_DIR}\` on ${new Date().toISOString()}.`,
    '> Derived from real hospital data — git-ignored, do not commit or share.',
    '',
    `Files: ${files.length}`,
    '',
  ];

  for (const f of files) {
    const path = join(SAMPLE_DIR, f);
    const wb = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: true, cellFormula: false });
    out.push(`## ${basename(f)}`, '', `Sheets: ${wb.SheetNames.map((s) => `\`${s}\``).join(', ')}`, '');
    wb.SheetNames.forEach((s, idx) => {
      const ws = wb.Sheets[s];
      if (ws) out.push(...profileSheet(s, ws, idx));
    });
    console.log(`profiled ${f} (${wb.SheetNames.length} sheets)`);
  }

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, out.join('\n'), 'utf8');
  console.log(`wrote ${OUT_FILE}`);
}

main();
