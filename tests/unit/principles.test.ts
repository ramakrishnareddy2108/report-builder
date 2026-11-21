// The principles of CLAUDE.md, as tests.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { generate } from '@/engine/generate';
import { openWorkbook } from '@/excel/readWorkbook';
import { bytesToBase64 } from '@/lib/base64';
import { blankDashboard } from '@/recipe/blank';
import { createLibrary, memoryStore } from '@/recipe/library';
import { inspectTemplateTask } from '@/worker/tasks/inspectTemplate';
import { files, PARAMS, recipe } from '../helpers/syntheticRecipe';
import { hisWorkbook } from '../helpers/syntheticWorkbook';

const input = (opts: { rename?: Record<string, string> } = {}) => ({
  recipe: recipe(),
  params: PARAMS,
  files: files().map((f) => ({ sourceId: f.sourceId, fileName: opts.rename?.[f.sourceId] ?? f.fileName, workbook: openWorkbook(f.bytes) })),
});

describe('1. stateless data: only recipes and dashboards are saved', () => {
  it('the library holds nothing but recipe: and dashboard: entries', async () => {
    const store = memoryStore();
    const lib = createLibrary(store);
    await lib.saveRecipe(recipe());
    await lib.saveDashboard(blankDashboard());
    const keys = (await store.entries()).map(([k]) => k);
    expect(keys.every((k) => k.startsWith('recipe:') || k.startsWith('dashboard:'))).toBe(true);
  });

  it('running a report never changes the recipe (no row, name or amount is written back into it)', async () => {
    const r = recipe();
    const before = JSON.stringify(r);
    await generate({ ...input(), recipe: r });
    expect(JSON.stringify(r)).toBe(before);
    expect(before).not.toMatch(/Kumar|Rao|UMR\d/); // the made-up doctors and patients of the month are not in it
  });

  it('only the app shell and the library touch browser storage: the engine, the readers and the dashboard code do not', () => {
    const banned = /idb-keyval|localStorage|sessionStorage|indexedDB|caches\.(open|put)/;
    const scan = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? scan(p) : /\.tsx?$/.test(n) ? [p] : [];
      });
    for (const dir of ['src/engine', 'src/excel', 'src/formula', 'src/dashboard', 'src/worker']) {
      for (const file of scan(dir)) expect(readFileSync(file, 'utf8'), file).not.toMatch(banned);
    }
  });

  it('the service worker stores only files of the app itself', () => {
    const sw = readFileSync('public/sw.js', 'utf8');
    expect(sw).toContain("url.origin !== self.location.origin"); // other origins are never touched
    expect(sw).toContain("request.method !== 'GET'"); // nothing that was posted is stored
  });
});

describe('3. never drop data silently', () => {
  it('every row of every source is accounted for: read = left out + used, and nothing is lost after that', async () => {
    const r = await generate(input());
    for (const s of r.sources) expect(s.stats.read, s.label).toBe(s.stats.filtered + s.stats.used);
    expect(r.combined.rows.length).toBe(r.sources.reduce((n, s) => n + s.stats.used, 0));
    expect(r.report?.inputRows).toBe(r.combined.rows.length);
    // the report holds every combined row's money: summing Amount over the combined rows equals the report columns that use it
    const reportTotal = (r.report?.totals?.['OP Revenue'] as number) + (r.report?.totals?.['OP Pharmacy'] as number);
    const combinedTotal = r.combined.rows.filter((x) => ['OP Billing', 'OP Pharmacy', 'OP Returns'].includes(String(x.Source))).reduce((n, x) => n + (typeof x.Amount === 'number' ? x.Amount : 0), 0);
    expect(reportTotal).toBe(combinedTotal);
  });

  it('what could not be read, what was left out and what was not found are all in the Checks', async () => {
    const r = await generate(input());
    const text = r.checks.map((c) => `${c.title} ${c.message}`).join('\n');
    expect(text).toMatch(/unreadable Amount/); // a number that could not be read
    expect(text).toMatch(/left out by the row filter/); // skipped rows, with the reason
    expect(text).toMatch(/not found/); // an unmatched lookup
    expect(text).toMatch(/Names cleaned: Doctor/); // names changed by cleanup
  });
});

describe('4. money is exact', () => {
  it('1000 sales of ₹0.10 add up to exactly ₹100.00', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => [`B${i}`, '03-OCT-2026', 'UMR1', 'Dr A', 'Cardio', 0.1]);
    const wb = hisWorkbook('Sheet1', ['BILLNO', 'BILLDT', 'UMRNO', 'DOCTORNAME', 'DEPARTMENTNAME', 'NETAMOUNT'], rows);
    const r = recipe();
    r.sources = r.sources.filter((s) => s.id === 'opBilling');
    r.lookups = [];
    r.cleanup = [];
    r.report.columns = r.report.columns.filter((c) => c.name === 'Doctor Name' || c.name === 'OP Revenue');
    r.checks.tieOuts = [];
    const out = await generate({ recipe: { ...r, report: { ...r.report, columns: r.report.columns } }, params: PARAMS, files: [{ sourceId: 'opBilling', fileName: 'x.xlsx', workbook: openWorkbook(wb) }] });
    expect(out.report?.rows[0]?.['OP Revenue']).toBe(10000); // paise, an exact integer
    expect(Number.isInteger(out.report?.totals?.['OP Revenue'])).toBe(true);
  });
});

describe('5. Excel output text is escaped', () => {
  it('text starting with = + - or @ is never a formula: not in the report, and not in the Checks sheet either', async () => {
    const out = await generate(input({ rename: { opBilling: '=evil Oct2026.xlsx' } }));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.workbookBytes as unknown as ArrayBuffer);
    const cells: string[] = [];
    for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => typeof c.value === 'string' && cells.push(c.value)));
    expect(cells.some((c) => c.includes('evil'))).toBe(true); // the name is shown...
    expect(cells.filter((c) => /^[=+\-@]/.test(c))).toEqual([]); // ...but never as something Excel would run
  });
});

describe('the template must be empty', () => {
  async function template(fill: boolean): Promise<string> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Report');
    ['S.No.', 'Doctor Name', 'Department', 'OP Revenue', 'Total Revenue'].forEach((h, i) => (ws.getRow(4).getCell(i + 1).value = h));
    for (let r = 5; r <= 9; r++) {
      ws.getRow(r).getCell(1).value = r - 4; // pre-numbered rows are normal
      ws.getRow(r).getCell(5).value = { formula: `D${r}`, result: 0 }; // so are formulas
    }
    if (fill) {
      ws.getRow(5).getCell(2).value = 'Dr A Kumar';
      ws.getRow(5).getCell(4).value = 12345.67;
      ws.getRow(6).getCell(2).value = 'Dr B Rao';
    }
    return bytesToBase64(new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer));
  }
  const output = { mode: 'template' as const, templateName: 't', templateBase64: '', headerRow: 'auto' as const, keepTemplateFormulas: true, includeChecksSheet: false, includeCombinedSheet: false };
  const reportColumns = ['S.No.', 'Doctor Name', 'Department', 'OP Revenue', 'Total Revenue'];

  it('an empty template (pre-numbered rows, formulas) has no filled rows; a filled report does', async () => {
    const empty = await inspectTemplateTask({ templateBase64: await template(false), output, reportColumns });
    const filled = await inspectTemplateTask({ templateBase64: await template(true), output, reportColumns });
    expect(empty.ok && empty.filledRows).toBe(0);
    expect(filled.ok && filled.filledRows).toBe(2);
  });
});
