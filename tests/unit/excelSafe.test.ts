import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { makeExcelSafe } from '@/excel/fillTemplate';

const RED = { font: { color: { argb: 'FF9C0006' } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } } };

/** What loading the real HIS-finance templates gives: a "duplicate values" rule and a _FilterDatabase name. */
function templateLikeWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  sheet.addRow(['S.No.', 'Doctor']);
  sheet.addRow([1, 'Dr A']);
  sheet.addConditionalFormatting({ ref: 'A4:A48', rules: [{ type: 'duplicateValues', style: RED, priority: 1 }] } as unknown as ExcelJS.ConditionalFormattingOptions);
  sheet.addConditionalFormatting({ ref: 'C2:C9', rules: [{ type: 'somethingElse', priority: 2 }] } as unknown as ExcelJS.ConditionalFormattingOptions);
  wb.definedNames.add('Sheet1!$A$3:$I$72', '_xlnm._FilterDatabase');
  wb.definedNames.add('Sheet1!$A$1:$B$2', 'MyRange');
  return wb;
}

async function roundTrip(wb: ExcelJS.Workbook): Promise<ExcelJS.Workbook> {
  const out = new ExcelJS.Workbook();
  await out.xlsx.load((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  return out;
}

const blocksOf = (wb: ExcelJS.Workbook) => (wb.worksheets[0] as unknown as { conditionalFormattings: { ref: string; rules: { type: string; formulae?: string[]; style?: unknown }[] }[] }).conditionalFormattings;

describe('makeExcelSafe: no content that makes Excel offer to repair the file', () => {
  it('without it, the library writes an empty conditional-format block (the bug)', async () => {
    const back = await roundTrip(templateLikeWorkbook());
    expect(blocksOf(back).some((b) => b.rules.length === 0)).toBe(true);
  });

  it('keeps "duplicate values" as an equivalent rule with the same colours, and drops what it cannot copy, with a note', async () => {
    const wb = templateLikeWorkbook();
    const notes = makeExcelSafe(wb);
    const back = await roundTrip(wb);
    const blocks = blocksOf(back);
    expect(blocks.every((b) => b.rules.length > 0)).toBe(true);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.ref).toBe('A4:A48');
    expect(blocks[0]?.rules[0]?.type).toBe('expression');
    expect(blocks[0]?.rules[0]?.formulae?.[0]).toBe('AND(LEN(A4)>0,COUNTIF($A$4:$A$48,A4)>1)');
    expect(JSON.stringify(blocks[0]?.rules[0]?.style)).toContain('FF9C0006');
    expect(notes).toHaveLength(1);
    expect(notes[0]?.message).toContain('C2:C9');
  });

  it('removes built-in names that lost their sheet, keeps the user\'s own names', async () => {
    const wb = templateLikeWorkbook();
    makeExcelSafe(wb);
    const back = await roundTrip(wb);
    expect(back.definedNames.model.map((n) => n.name)).toEqual(['MyRange']);
  });

  it('does nothing to a clean workbook', () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1');
    expect(makeExcelSafe(wb)).toEqual([]);
  });
});
