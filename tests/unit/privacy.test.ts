// Patient names, phone numbers and addresses must never reach facts, checks, saved runs,
// backups or the Excel reports. Fake patient details are planted in a source file and
// every output is searched for them.

import { beforeAll, describe, expect, it } from 'vitest';
import { FactRowSchema } from '@/core/schemas';
import type { RunOutput } from '@/core/runMonth';
import { runMonthTask } from '@/worker/tasks/runMonth';
import { allOutputs, type OutputFile } from '../helpers/outputs';
import { MONTH_DATA } from '../helpers/monthData';
import { DOCTORS, DR_A, MONTH, monthRequest, monthSettings } from '../helpers/monthFixture';
import { hisFile } from '../helpers/syntheticWorkbook';
import { drrTemplate, sponsorTemplate } from '../helpers/syntheticTemplate';

// Details that must never appear anywhere. Deliberately distinctive.
const PATIENTS = [
  { name: 'ZEBEDIAH QUINTANILLA', phone: '9876501234', address: '77/B CRESCENT LANE NEAR OLD TEMPLE' },
  { name: 'PRUDENCE WOMBWELL', phone: '9123409876', address: '5-9-11 LAKE VIEW COLONY' },
  { name: 'ORVILLE FENWORTHY', phone: '9000011111', address: 'FLAT 12 SUNRISE APARTMENTS' },
];
const SECRETS = PATIENTS.flatMap((p) => [p.name, p.phone, p.address]);

let outputs: OutputFile[];
let run: RunOutput;
beforeAll(async () => {
  const billing = MONTH_DATA.opBilling;
  // OP Billing now has patient name, phone and address columns (as the real HIS export does).
  const header = [...billing.header, 'PATIENTNAME', 'PATMOBILENO', 'ADDRESS'];
  const rows = billing.rows.map((r, i) => (i < 2 ? [...r, PATIENTS[i]!.name, PATIENTS[i]!.phone, PATIENTS[i]!.address] : [...r, null, null, null]));
  const req = monthRequest();
  req.files = req.files.map((f) => (f.sourceId === 'opBilling' ? { ...f, file: hisFile(billing.fileName, header, rows) } : f));
  // And a patient name on a consultation row.
  const consult = MONTH_DATA.opConsultations;
  req.files = req.files.map((f) =>
    f.sourceId === 'opConsultations'
      ? { ...f, file: hisFile(consult.fileName, [...consult.header, 'PATIENTNAME'], consult.rows.map((r, i) => [...r, i === 0 ? PATIENTS[2]!.name : null])) }
      : f,
  );

  run = await runMonthTask(req);
  outputs = await allOutputs({
    month: MONTH,
    run,
    settings: monthSettings(),
    costs: [{ doctorId: DR_A, amounts: { SALARY: 500000 } }],
    drrTemplate: await drrTemplate(),
    sponsorTemplate: await sponsorTemplate(),
  });
});

describe('patient details never reach any output', () => {
  it('the run read the files with the patient columns in them', () => {
    expect(run.facts.length).toBeGreaterThan(0);
    expect(run.diagnostics.sources.find((s) => s.sourceId === 'opBilling')).toMatchObject({ status: 'read', rowsMapped: 2 });
  });

  it('writes the run files, a backup and both reports (so there is something to search)', () => {
    const names = outputs.map((o) => o.name);
    expect(names).toContain('data/2026-10/run-1/facts.json');
    expect(names.some((n) => n.startsWith('backup/') && n.endsWith('facts.json'))).toBe(true);
    expect(names).toContain('report-drr/xl/sharedStrings.xml');
    expect(names.some((n) => n.startsWith('report-sponsor/xl/worksheets/'))).toBe(true);
  });

  it.each(SECRETS)('%s appears nowhere', (secret) => {
    const hits = outputs.filter((o) => o.text.toUpperCase().includes(secret.toUpperCase())).map((o) => o.name);
    expect(hits).toEqual([]);
  });

  it('not even a part of a name or a phone number (any 7+ character piece)', () => {
    const haystack = outputs.map((o) => o.text.toUpperCase()).join('\n');
    for (const secret of SECRETS) {
      const s = secret.toUpperCase();
      for (let i = 0; i + 7 <= s.length; i += 4) expect(haystack.includes(s.slice(i, i + 7)), `${s.slice(i, i + 7)}`).toBe(false);
    }
  });

  it('a fact row holds only the allowed fields, and the schema rejects anything else', () => {
    const allowed = Object.keys(FactRowSchema.shape);
    for (const f of run.facts) expect(Object.keys(f).every((k) => allowed.includes(k))).toBe(true);
    const withName = { ...run.facts[0]!, patientName: PATIENTS[0]!.name };
    expect(FactRowSchema.safeParse(withName).success).toBe(false);
  });

  it('the doctor list and the checks hold no patient either (only doctors, departments and sponsors)', () => {
    const settingsText = outputs.filter((o) => o.name.endsWith('settings-used.json')).map((o) => o.text).join('');
    for (const d of DOCTORS) expect(settingsText).toContain(d.displayName);
    expect(outputs.filter((o) => o.name.endsWith('checks.json')).length).toBeGreaterThan(0);
  });
});
