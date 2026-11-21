import { describe, expect, it } from 'vitest';
import { sha256Hex } from '@/excel/fingerprint';
import type { TaskProgress } from '@/worker/protocol';
import { readFileTask } from '@/worker/tasks/readFile';
import { consultationsWorkbook } from '../helpers/syntheticWorkbook';

function file(bytes: Uint8Array, name: string): File {
  return new File([bytes as Uint8Array<ArrayBuffer>], name, { lastModified: 1_790_000_000_000 });
}

describe('readFileTask', () => {
  const bytes = consultationsWorkbook();

  it('fingerprints, identifies the source and reads the rows', async () => {
    const progress: TaskProgress[] = [];
    const r = await readFileTask({ file: file(bytes, 'OP Consultations Report Oct2026.xlsx') }, (p) => progress.push(p));

    expect(r.sha256).toBe(await sha256Hex(bytes));
    expect(r.sizeBytes).toBe(bytes.length);
    expect(r.sheets.map((s) => s.name)).toEqual(['Sheet1', 'Sheet2', 'Offset']);
    expect(r.sheets[1]!.header).toBeNull();

    expect(r.identification).toMatchObject({ sourceId: 'opConsultations', method: 'name', confidence: 1 });
    expect(r.sheet).toBe('Sheet1');
    expect(r.header?.headerRow).toBe(3);
    expect(r.data?.rowCount).toBe(6);
    expect(r.data?.rows[3]![7]).toBe(450); // cached formula value

    const fractions = progress.map((p) => p.fraction);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(progress.at(-1)).toEqual({ stage: 'Done', fraction: 1 });
  });

  it('honours a chosen sheet, header row and headers-only mode', async () => {
    const r = await readFileTask({ file: file(bytes, 'x.xlsx'), sheet: 'Offset', headerRow: 5, headersOnly: true });
    expect(r.sheet).toBe('Offset');
    expect(r.data).toBeNull();
    expect(r.header?.headers).toEqual(['Column A', 'Column B', 'BILLNO', 'AMOUNT']);
  });

  it('gives a plain-language error for a file that is not a workbook', async () => {
    await expect(readFileTask({ file: file(new Uint8Array(), 'empty.xlsx') })).rejects.toThrow('The file is empty.');
  });
});
