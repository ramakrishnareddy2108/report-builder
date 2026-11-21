// Proof on the real October 2026 data that no patient name, phone number or address reaches
// the facts, checks, saved run, backup or the two Excel reports. The patient details are read
// from the real files and every output is searched for them. Prints counts only, never values.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { doctorReport, sponsorReport } from '@/core/report';
import { isPatientColumn } from '@/excel/mapSource';
import { allOutputs } from '../helpers/outputs';
import { SAMPLES_DIR, runOctober, samplesPresent } from '../helpers/realOctober';

const DRR = `${SAMPLES_DIR}/expected/DRR Format.xlsx`;
const SPONSOR = `${SAMPLES_DIR}/Sponsor-wise Revenue Report.xlsx`;

/** Columns that identify a patient (not "patient source" and similar), by header. */
const IDENTIFYING = /^(patient\s?name|patname|pat\s?mobile\s?no|patient\s?mobile.*|address|mobile.*|phone.*|contact.*|guardian.*|relative.*)$/i;

describe.skipIf(!samplesPresent)('real October data: no patient details in any output', () => {
  it('finds none of the real patient names, phones or addresses', { timeout: 240_000 }, async () => {
    const { run, settings, costs, files } = await runOctober();

    // 1. Every patient name, phone number and address in the real files.
    const secrets = new Set<string>();
    let columns = 0;
    for (const { file } of files) {
      const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', dense: false });
      for (const sheetName of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName]!, { header: 1, raw: false, defval: null });
        for (const [h, header] of (rows.find((r) => r.some((c) => typeof c === 'string' && IDENTIFYING.test(c.trim()))) ?? []).entries()) {
          if (typeof header !== 'string' || !IDENTIFYING.test(header.trim()) || !isPatientColumn(header)) continue;
          columns++;
          for (const r of rows) {
            const v = r[h];
            if (typeof v === 'string' && v.trim().length >= 6 && v.trim().toUpperCase() !== header.trim().toUpperCase()) secrets.add(v.trim().toUpperCase());
          }
        }
      }
    }
    // Business names (doctors, departments, sponsors) may legitimately equal or contain a patient value; leave those out.
    const business = new Set<string>();
    for (const d of settings.doctors.doctors) [d.displayName, ...d.aliases].forEach((n) => business.add(n.trim().toUpperCase()));
    for (const f of run.facts) [f.sponsor, f.departmentId].forEach((n) => n && business.add(n.toUpperCase()));
    // A patient who shares a name with part of a doctor's name cannot be told apart from that doctor.
    for (const s of [...secrets]) if ([...business].some((b) => b.includes(s))) secrets.delete(s);
    expect(columns, 'patient columns found in the real files').toBeGreaterThan(0);
    expect(secrets.size, 'patient values to search for').toBeGreaterThan(100);

    // 2. Every output of the run.
    const outputs = await allOutputs({
      month: '2026-10',
      run,
      settings,
      costs,
      drrTemplate: readFileSync(DRR),
      sponsorTemplate: readFileSync(SPONSOR),
    });
    expect(doctorReport(run.facts, costs, settings.doctors.doctors, '2026-10').length).toBeGreaterThan(10);
    expect(sponsorReport(run.facts, '2026-10').length).toBeGreaterThan(5);

    // 3. Search: exact string values (facts, workbook cells) and, in the small text outputs, substrings.
    const strings = new Set<string>();
    const collect = (v: unknown): void => {
      if (typeof v === 'string') strings.add(v.trim().toUpperCase());
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === 'object') Object.values(v).forEach(collect);
    };
    for (const o of outputs) {
      if (o.name.endsWith('.json')) collect(JSON.parse(o.text));
      else for (const m of o.text.matchAll(/<t[^>]*>([^<]*)<\/t>/g)) strings.add(decodeXml(m[1] as string).trim().toUpperCase());
    }
    const exact = [...secrets].filter((s) => strings.has(s));

    const small = outputs.filter((o) => !/facts\.json$|worksheets\/sheet\d+\.xml$/.test(o.name)).map((o) => o.text.toUpperCase()).join('\n');
    const embedded = [...secrets].filter((s) => s.length >= 8 && small.includes(s));

    // Phone numbers: any run of 10 digits in an output must not be a patient phone.
    const phones = new Set([...secrets].filter((s) => /^\+?\d[\d\s-]{8,}$/.test(s)).map((s) => s.replace(/\D/g, '').slice(-10)));
    const digits = outputs.flatMap((o) => o.text.match(/\d{10}/g) ?? []);
    const phoneHits = digits.filter((d) => phones.has(d));

    console.info(
      `Searched ${secrets.size.toLocaleString('en-IN')} patient values (${phones.size} phone numbers) from ${columns} patient columns ` +
        `in ${outputs.length} output files (${strings.size.toLocaleString('en-IN')} distinct text values): ` +
        `${exact.length} exact matches, ${embedded.length} embedded matches, ${phoneHits.length} phone matches.`,
    );
    expect(exact).toEqual([]);
    expect(embedded).toEqual([]);
    expect(phoneHits).toEqual([]);
  });
});

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
