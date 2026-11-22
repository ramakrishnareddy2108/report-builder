// Golden test: the starter DRR and Sponsor-wise recipes on the REAL October 2026 files in samples/2026-10/.
//
// samples/ is git-ignored (patient data never goes into git), so this test skips itself when the folder is absent,
// for example in CI. When it runs it PRINTS totals and check counts and, if samples/2026-10/expected/ holds a FILLED
// DRR, a table of differences per doctor and column. Differences are not failures: they point at business rules to
// confirm with the finance team. Do NOT change a rule only to make a number match.
//
// Only rule-independent facts are asserted: nothing is dropped between the files and the report, and the totals
// row equals the sum of the rows.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { assignFiles } from '@/engine/assignFiles';
import { generate } from '@/engine/generate';
import { formatINR } from '@/core/money';
import { openWorkbook } from '@/excel/readWorkbook';
import { bytesToBase64 } from '@/lib/base64';
import { starterRecipes } from '@/recipe/defaults';
import type { Recipe } from '@/recipe/schema';
import { inspectFileTask } from '@/worker/tasks/inspectFile';
import { readOutputFile, stackData } from '@/dashboard/data';
import { starterDashboards } from '@/dashboard/defaults';
import { computeTile } from '@/dashboard/tiles';

const DIR = 'samples/2026-10';
const present = existsSync(DIR);
if (!present) console.log(`[golden] ${DIR} not found: the DRR golden test is skipped (this is expected in CI).`);

const TEMPLATES: Record<string, string> = {
  'starter-drr': join(DIR, 'expected', 'DRR Format.xlsx'),
  'starter-sponsor-wise': existsSync(join(DIR, 'expected', 'Sponsor-wise Revenue Report.xlsx')) ? join(DIR, 'expected', 'Sponsor-wise Revenue Report.xlsx') : join(DIR, 'Sponsor-wise Revenue Report.xlsx'),
};

const runs = new Map<string, ReturnType<typeof runUncached>>();
/** One run per recipe: the files are big, and the tests below only read the result. */
function run(recipe: Recipe) {
  let r = runs.get(recipe.id);
  if (!r) {
    r = runUncached(recipe);
    runs.set(recipe.id, r);
  }
  return r;
}

async function runUncached(recipe: Recipe) {
  const names = readdirSync(DIR).filter((n) => n.endsWith('.xlsx') && !/sponsor-wise revenue report/i.test(n));
  const bytes = new Map(names.map((n) => [n, new Uint8Array(readFileSync(join(DIR, n)))]));
  const probes = [];
  for (const n of names) {
    const r = await inspectFileTask({ file: new File([bytes.get(n) as Uint8Array<ArrayBuffer>], n), headersOnly: true });
    probes.push({ name: n, sheets: r.sheets });
  }
  const assigned = assignFiles(probes, recipe);
  const files = assigned.assignments.map((a) => ({ sourceId: a.sourceId, fileName: a.fileName, workbook: openWorkbook(bytes.get(a.fileName) as Uint8Array) }));

  const templatePath = TEMPLATES[recipe.id];
  const withTemplate: Recipe =
    recipe.output.mode === 'template' && templatePath && existsSync(templatePath)
      ? { ...recipe, output: { ...recipe.output, templateBase64: bytesToBase64(new Uint8Array(readFileSync(templatePath))) } }
      : recipe;
  const result = await generate({ recipe: withTemplate, params: { Month: 'Oct-2026' }, files, ignoredFiles: assigned.unassignedFiles });
  return { assigned, result, usedTemplate: withTemplate !== recipe };
}

function printSummary(name: string, r: Awaited<ReturnType<typeof run>>) {
  const { assigned, result } = r;
  const lines: string[] = [`\n[golden] ${name}`];
  lines.push(`  files: ${assigned.assignments.map((a) => `${a.sourceId}←${a.fileName}`).join('; ')}`);
  if (assigned.unassignedFiles.length) lines.push(`  not used: ${assigned.unassignedFiles.join(', ')}`);
  if (assigned.ambiguous.length) lines.push(`  AMBIGUOUS: ${assigned.ambiguous.map((a) => a.fileName).join(', ')}`);
  if (assigned.missingRequiredSources.length) lines.push(`  MISSING required: ${assigned.missingRequiredSources.join(', ')}`);
  for (const s of result.sources) {
    const st = s.stats;
    lines.push(`  ${s.label.padEnd(18)} read ${st.read}, left out ${st.filtered}, used ${st.used}, unreadable ${Object.values(st.unreadableByColumn).reduce((a, b) => a + b, 0)}, repeated ${st.duplicateRows}`);
  }
  for (const l of result.lookups) lines.push(`  lookup ${l.label}: ${JSON.stringify(l.byStatus)}`);
  const counts = { error: 0, warning: 0, info: 0 };
  for (const c of result.checks) counts[c.level]++;
  lines.push(`  checks: ${counts.error} errors, ${counts.warning} warnings, ${counts.info} info; can download: ${result.canDownload}`);
  for (const c of result.checks.filter((x) => x.level !== 'info')) lines.push(`    [${c.level}] ${c.title}: ${c.message.slice(0, 200)}`);
  const t = result.report?.totals;
  if (t && result.report) {
    lines.push(`  report: ${result.report.rows.length} rows. Totals:`);
    for (const c of result.report.columns) {
      const v = t[c.name];
      if (typeof v === 'number') lines.push(`    ${c.name.padEnd(26)} ${c.type === 'money' ? formatINR(v) : v}`);
    }
  }
  console.log(lines.join('\n'));
}

describe.skipIf(!present)('golden: October 2026 with the starter recipes', () => {
  for (const recipe of present ? starterRecipes() : []) {
    describe(recipe.name, () => {
      it('reads every source, accounts for every row, and the report adds up', async () => {
        const r = await run(recipe);
        printSummary(recipe.name, r);
        const { result, assigned } = r;

        // every required source got exactly one file
        expect(assigned.missingRequiredSources).toEqual([]);
        expect(assigned.ambiguous).toEqual([]);

        // no row disappears between a file and the combined table
        for (const s of result.sources) {
          expect(s.errors, `${s.label} read errors`).toEqual([]);
          expect(s.stats.read, `${s.label}: read = left out + used`).toBe(s.stats.filtered + s.stats.used);
        }
        expect(result.combined.rows.length).toBe(result.sources.reduce((n, s) => n + s.stats.used, 0));

        // the report is built, the totals row is the sum of the rows
        expect(result.report, 'the report was not built: ' + result.checks.filter((c) => c.level === 'error').map((c) => c.message).join(' | ')).not.toBeNull();
        const report = result.report!;
        for (const c of report.columns.filter((x) => x.kind === 'aggregate' && x.type !== 'text')) {
          const sum = report.rows.reduce((n, row) => n + (typeof row[c.name] === 'number' ? (row[c.name] as number) : 0), 0);
          expect(report.totals?.[c.name], `totals row of ${c.name}`).toBe(sum);
        }
        expect(result.checks.filter((c) => c.level === 'error')).toEqual([]);
        expect(result.workbookBytes?.length ?? 0).toBeGreaterThan(0);
      }, 120_000);

      it('feeds the dashboard: the saved report reads back, and the KPIs equal the report totals', async () => {
        if (recipe.id !== 'starter-drr') return;
        const r = await run(recipe);
        const report = r.result.report!;
        const saved = readOutputFile(r.result.workbookBytes as Uint8Array, { fileName: 'DRR_Oct-2026.xlsx', recipe });
        expect(saved.rows.length, 'every report row is read back').toBe(report.rows.length);
        // a second month: the same report relabelled, so the comparison tiles have something to compare
        const sep = { ...saved, rows: saved.rows.map((row) => ({ ...row, Month: 'Sep-2026', _file: 'DRR_Sep-2026.xlsx' })) };
        const both = stackData([sep, saved]);
        const [dash] = starterDashboards();
        for (const t of dash!.tiles) expect(computeTile(t, both).status, t.title).toBe('ok');
        const kpi = computeTile(dash!.tiles[0]!, both) as { value: number; previous: number; change: number };
        expect(Math.round(kpi.value * 100)).toBe(report.totals?.['Total Revenue']);
        expect(kpi.change).toBe(0);
      }, 120_000);

      it('compares with a filled report in expected/ when there is one (prints the differences)', async () => {
        const path = TEMPLATES[recipe.id];
        if (recipe.id !== 'starter-drr' || !path || !existsSync(path)) return console.log(`[golden] no expected file for ${recipe.name}: comparison skipped.`);

        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(readFileSync(path) as unknown as ArrayBuffer);
        const ws = wb.worksheets[0];
        const headerRow = 4;
        const header = new Map<string, number>();
        ws?.getRow(headerRow).eachCell((cell, col) => void header.set(String(cell.value ?? '').replace(/\s+/g, '').toLowerCase(), col));
        const nameCol = header.get('doctorname');
        const filled = ws && nameCol ? Array.from({ length: Math.max(0, ws.rowCount - headerRow) }, (_, i) => ws.getRow(headerRow + 1 + i)).filter((row) => String(row.getCell(nameCol).value ?? '').trim() !== '') : [];
        if (filled.length === 0) return console.log('[golden] expected/DRR Format.xlsx is an empty template, not a filled October DRR: comparison skipped.');

        const r = await run(recipe);
        const key = (name: unknown, dept: unknown) => `${String(name ?? '').replace(/[\s.]+/g, ' ').trim().toLowerCase()}|${String(dept ?? '').replace(/[\s.]+/g, ' ').trim().toLowerCase()}`;
        const actual = new Map((r.result.report?.rows ?? []).map((row) => [key(row['Doctor Name'], row.Department), row] as const));
        const diffs: string[] = [];
        const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'object' && v !== null && 'result' in v && typeof (v as { result: unknown }).result === 'number' ? (v as { result: number }).result : 0);
        for (const row of filled) {
          const dept = header.get('department');
          const k = key(row.getCell(nameCol as number).value, dept ? row.getCell(dept).value : '');
          const mine = actual.get(k);
          if (!mine) {
            diffs.push(`${k}: in the expected report but not in the generated one`);
            continue;
          }
          for (const col of r.result.report?.columns ?? []) {
            const at = header.get(col.name.replace(/\s+/g, '').toLowerCase());
            if (at === undefined || col.type === 'text' || col.type === 'date' || col.kind === 'serial') continue;
            const expected = Math.round(num(row.getCell(at).value) * (col.type === 'money' ? 100 : 1));
            const got = typeof mine[col.name] === 'number' ? (mine[col.name] as number) : 0;
            if (expected !== got) diffs.push(`${k} | ${col.name}: expected ${col.type === 'money' ? formatINR(expected) : expected}, got ${col.type === 'money' ? formatINR(got) : got}`);
            actual.delete(k + '#seen');
          }
          actual.delete(k);
        }
        for (const k of actual.keys()) diffs.push(`${k}: generated but not in the expected report`);
        console.log(`[golden] differences against expected DRR (${diffs.length}):\n  ${diffs.slice(0, 80).join('\n  ')}`);
      }, 120_000);
    });
  }
});

// ---- the business rules finance confirmed (see "Default DRR recipe" in CLAUDE.md) ----------------------------------
//
// These ARE rule-dependent: they pin the October 2026 totals that finance confirmed. If one fails, the data or a rule
// changed; find out which before touching the number. All amounts are integer paise.

const paise = (rupees: string) => Math.round(Number(rupees.replace(/,/g, '')) * 100);

describe.skipIf(!present)('golden: October 2026, the confirmed finance rules', () => {
  const [drr, sponsor] = present ? (starterRecipes() as [Recipe, Recipe]) : ([] as unknown as [Recipe, Recipe]);
  const money = (n: number) => formatINR(n);

  it('DRR: column totals, the excluded unattributed pharmacy, and the Checks', async () => {
    const { result } = await run(drr);
    const report = result.report!;
    const t = report.totals!;
    const ex = report.excluded;
    const exSales = ex?.amounts['OP Pharmacy'] ?? 0;
    const exCost = ex?.amounts['OP Pharmacy Cost'] ?? 0;

    const lines = ['\n[golden] DRR column totals (Month = Oct-2026)'];
    for (const c of report.columns) if (typeof t[c.name] === 'number') lines.push(`  ${c.name.padEnd(26)} ${c.type === 'money' ? money(t[c.name] as number) : t[c.name]}`);
    lines.push(`  OP Revenue = OP Billing ${money(Number(report.sourceShares['OP REVENUE']?.['OP BILLING']))} + OP Consultations ${money(Number(report.sourceShares['OP REVENUE']?.['OP CONSULTATIONS']))}`);
    lines.push(`  excluded (unattributed OP pharmacy): ${ex?.rows} lines, sales ${money(exSales)}, cost ${money(exCost)}`);
    for (const g of ex?.groups ?? []) lines.push(`    ${g.label}: ${g.rows} lines, sales ${money(g.amounts['OP Pharmacy'] ?? 0)}, cost ${money(g.amounts['OP Pharmacy Cost'] ?? 0)}`);
    for (const l of result.lookups) {
      const by = l.byStatus;
      const amt = l.amountByStatus;
      lines.push(`  lookup ${l.label}: Matched ${by.Matched} (${money(amt.Matched)}), Fallback ${by.Fallback} (${money(amt.Fallback)}), Ambiguous ${by.Ambiguous} (${money(amt.Ambiguous)}), Unattributed ${by.Unattributed} (${money(amt.Unattributed)})`);
    }
    lines.push('  checks:');
    for (const c of result.checks) lines.push(`    [${c.level}] ${c.title}: ${c.message.slice(0, 260)}`);
    console.log(lines.join('\n'));

    expect(t['OP Revenue']).toBe(paise('31,36,235.60'));
    expect(report.sourceShares['OP REVENUE']?.['OP BILLING']).toBe(paise('23,64,677.60'));
    expect(report.sourceShares['OP REVENUE']?.['OP CONSULTATIONS']).toBe(paise('7,71,558.00'));
    expect(t['IP Count']).toBe(499);
    expect(t['IP Revenue']).toBe(paise('3,97,19,088.00'));
    expect(t['IP Pharmacy revenue Net']).toBe(paise('1,23,73,098.00'));
    expect(t['Ip Pharmacy Cost']).toBe(paise('55,16,177.00'));
    // OP Pharmacy: 17,50,813.19 (sales net of returns) minus the unattributed lines, which are listed in the Checks instead
    expect(t['OP Pharmacy']).toBe(paise('17,50,813.19') - exSales);
    expect(ex?.rows).toBeGreaterThan(0);
    expect(ex?.groups.map((g) => g.label)).toEqual(['no UMRNO (counter sales)', 'UMRNO with no consultation this month']);
    expect(ex?.groups.reduce((n, g) => n + g.rows, 0)).toBe(ex?.rows);
    // no report row is the unattributed doctor
    expect(report.rows.filter((r) => /unattributed/i.test(String(r['Doctor Name'])))).toEqual([]);
    // the report still adds up: total revenue and gross profit follow the rule of the template
    expect(t['Total Revenue']).toBe((t['IP Revenue'] as number) + (t['OP Revenue'] as number) + (t['OP Pharmacy'] as number));
    expect(t['Gross Profit']).toBe((t['Total Revenue'] as number) - (t['OP Pharmacy Cost'] as number) - (t['Ip Pharmacy Cost'] as number));

    // the Checks
    const byTitle = (title: string) => result.checks.find((c) => c.title === title);
    for (const name of ['OP Billing total', 'OP Consultations total', 'OP Pharmacy total']) expect(byTitle(`Tie-out: ${name}`)?.level, name).toBe('info');
    expect(byTitle('Excluded from report: unattributed OP pharmacy')?.message).toMatch(/lines, sales ₹.*, cost ₹/);
    expect(byTitle('Pharmacy to admitted patients excluded (billed in IP bill)')?.rows).toBe(6018 + 133);
    expect(result.checks.some((c) => c.level === 'warning' && /^Costs file not uploaded — /.test(c.message))).toBe(true);
    expect(result.checks.filter((c) => c.level === 'error')).toEqual([]);
  }, 120_000);

  it('DRR spot check: Bala Krishna Sanampudi OP Revenue = billing + consultations (+ his "(REVIEW)" billing row, which the cleanup merges)', async () => {
    const { result } = await run(drr);
    const rows = result.report!.rows.filter((r) => String(r['Doctor Name']).toLowerCase() === 'bala krishna sanampudi');
    const opRevenue = rows.reduce((n, r) => n + (r['OP Revenue'] as number), 0);

    // The raw OP Billing file: this doctor is written two ways, the plain name (78 rows) and "... (REVIEW)" (1 row).
    const wb = XLSX.read(readFileSync(join(DIR, readdirSync(DIR).find((n) => /^OP Billing Report/i.test(n)) as string)), { type: 'buffer' });
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Sheet1']!, { range: 2, raw: true });
    const billing = (match: RegExp) => raw.filter((r) => match.test(String(r.DOCTORNAME ?? ''))).reduce((n, r) => n + Math.round(Number(r.NETAMOUNT ?? 0) * 100), 0);
    const plainBilling = billing(/^\s*bala krishna sanampudi\s*$/i);
    const reviewBilling = billing(/^\s*bala krishna sanampudi\s*\(review\)\s*$/i);

    const mine = result.combined.rows.filter((r) => String(r.Doctor ?? '').toLowerCase() === 'bala krishna sanampudi');
    const consultations = mine.filter((r) => r.Source === 'OP Consultations').reduce((n, r) => n + (typeof r.Amount === 'number' ? r.Amount : 0), 0);
    console.log(
      `\n[golden] Bala Krishna Sanampudi: report OP Revenue ${money(opRevenue)} = billing ${money(plainBilling)} + consultations ${money(consultations)} + billing written "(REVIEW)" ${money(reviewBilling)}`,
    );

    // finance's spot check: billing 1,73,604.50 + consultations 1,17,300.00 = 2,90,904.50
    expect(plainBilling).toBe(paise('1,73,604.50'));
    expect(consultations).toBe(paise('1,17,300.00'));
    expect(plainBilling + consultations).toBe(paise('2,90,904.50'));
    // one more OP Billing row of Rs 500 is written "BALA KRISHNA SANAMPUDI (REVIEW)". The cleanup strips " (REVIEW)" (as asked), so it
    // is the same doctor and the report holds 2,91,404.50. If finance wants the review row kept apart, switch the suffix off in Prepare.
    expect(reviewBilling).toBe(paise('500.00'));
    expect(rows.length).toBeGreaterThan(0);
    expect(opRevenue).toBe(paise('2,90,904.50') + reviewBilling);
  }, 120_000);

  it('Sponsor-wise: nothing is excluded, so OP Pharmacy is the full 17,50,813.19', async () => {
    const { result } = await run(sponsor);
    const report = result.report!;
    const t = report.totals!;
    console.log(`\n[golden] Sponsor-wise: OP Revenue ${money(t['OP Revenue'] as number)}, OP Pharmacy ${money(t['OP Pharmacy'] as number)}, excluded rows ${report.excluded?.rows ?? 0}`);
    expect(report.excluded).toBeNull();
    expect(t['OP Pharmacy']).toBe(paise('17,50,813.19'));
    expect(t['OP Revenue']).toBe(paise('31,36,235.60'));
    expect(t['IP Count']).toBe(499);
    // the unattributed pharmacy stays under its sponsor
    expect(report.rows.reduce((n, r) => n + (r['OP Pharmacy'] as number), 0)).toBe(paise('17,50,813.19'));
    for (const name of ['OP Billing total', 'OP Consultations total', 'OP Pharmacy total']) expect(result.checks.find((c) => c.title === `Tie-out: ${name}`)?.level, name).toBe('info');
    // Sponsor-wise has no cost columns, so a missing Costs file is not a warning there
    expect(result.checks.some((c) => /Costs file not uploaded/.test(c.message))).toBe(false);
    expect(result.checks.filter((c) => c.level === 'error')).toEqual([]);
  }, 120_000);
});
