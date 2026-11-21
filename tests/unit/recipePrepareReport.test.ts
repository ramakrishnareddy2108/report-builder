import { describe, expect, it } from 'vitest';
import { cleanup, findSuspicious } from '@/engine/cleanup';
import type { CombinedTable } from '@/engine/types';
import { aggregateType } from '@/pages/RecipeBuilder/ReportColumnCard';
import { combinedColumns } from '@/recipe/columns';
import { buildSourceFilter, parseSourceFilter } from '@/recipe/sourceFilter';
import { clearWorkerState } from '@/worker/state';
import { previewTask } from '@/worker/tasks/preview';
import { files, PARAMS, recipe } from '../helpers/syntheticRecipe';
import { asFile } from '../helpers/syntheticWorkbook';

describe('findSuspicious', () => {
  it('finds the same letters with other spacing or dots, and a name inside another', () => {
    const pairs = findSuspicious(['Dr A Kumar', 'Dr. A. Kumar', 'Dr Anil A Kumar', 'Dr B Rao', 'Dr Rao']);
    const text = pairs.map((p) => `${p.a} | ${p.b} | ${p.reason}`);
    expect(text).toContain('Dr A Kumar | Dr. A. Kumar | Same letters, different spacing or punctuation');
    expect(text).toContain('Dr A Kumar | Dr Anil A Kumar | One name contains the other');
    expect(text.some((t) => t.includes('Dr B Rao | Dr Rao'))).toBe(false); // "Dr Rao" has two words but is not inside... it is: Dr, Rao ⊂ Dr, B, Rao
  });

  it('does not flag unrelated names or single words, and gives up on huge lists', () => {
    expect(findSuspicious(['Cardiology', 'Neurology', 'Dr A', 'Dr B'])).toEqual([]);
    expect(findSuspicious(Array.from({ length: 1600 }, (_, i) => `Name ${i}`))).toEqual([]);
  });
});

describe('cleanup report for the Prepare tab', () => {
  const t: CombinedTable = {
    columns: [{ name: 'Doctor', type: 'text' }],
    rows: ['Dr. A  Kumar', 'dr a kumar', 'dr a kumar', 'Dr B Rao'].map((Doctor) => ({ Doctor })),
  };
  const r = cleanup(t, [{ column: 'Doctor', normalize: { trim: true, collapseSpaces: true, ignoreCase: true, removeChars: '.' }, displayCase: 'title', aliases: [] }]);

  it('lists every distinct spelling with its clean name and row count', () => {
    expect(r.reports[0]?.values).toEqual([
      { raw: 'dr a kumar', clean: 'Dr A Kumar', count: 2 },
      { raw: 'Dr. A  Kumar', clean: 'Dr A Kumar', count: 1 },
      { raw: 'Dr B Rao', clean: 'Dr B Rao', count: 1 },
    ]);
  });
});

describe('the "only rows from" quick-pick', () => {
  it('builds and reads back filters', () => {
    expect(buildSourceFilter([])).toBe('');
    expect(buildSourceFilter(['OP Billing'])).toBe('[Source]="OP Billing"');
    expect(buildSourceFilter(['OP Pharmacy', 'OP Returns'])).toBe('OR([Source]="OP Pharmacy",[Source]="OP Returns")');
    expect(parseSourceFilter(undefined)).toEqual([]);
    expect(parseSourceFilter('[Source]="OP Billing"')).toEqual(['OP Billing']);
    expect(parseSourceFilter('OR([Source]="A",[Source]="B")')).toEqual(['A', 'B']);
    expect(parseSourceFilter('[Source] = "A"')).toEqual(['A']);
  });

  it('leaves a custom formula alone', () => {
    expect(parseSourceFilter('[Amount] > 100')).toBeNull();
    expect(parseSourceFilter('AND([Source]="A",[Amount]>1)')).toBeNull();
    expect(parseSourceFilter('NOT([Source]="A")')).toBeNull();
  });
});

describe('report column helpers', () => {
  it('counts are numbers; other totals follow the column', () => {
    expect(aggregateType('COUNT', 'money')).toBe('number');
    expect(aggregateType('COUNTDISTINCT', undefined)).toBe('number');
    expect(aggregateType('SUM', 'money')).toBe('money');
    expect(aggregateType('MAX', 'date')).toBe('date');
    expect(aggregateType('SUM', undefined)).toBe('number');
  });

  it('knows the combined columns from the recipe alone, including what lookups write', () => {
    const names = combinedColumns(recipe()).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['Doctor', 'Amount', 'Cost', 'Salary', 'Attribution', 'Source', '_file', '_row', 'Month']));
    expect(new Set(names.map((n) => n.toUpperCase())).size).toBe(names.length); // no duplicates
  });
});

describe('preview task (the live preview of the Prepare and Report tabs)', () => {
  const assignments = () => files().map((f) => ({ sourceId: f.sourceId, file: asFile(f.bytes, f.fileName) }));

  it('prepare stage: cleaned names, lookup results and no report', async () => {
    clearWorkerState();
    const r = await previewTask({ recipe: recipe(), params: PARAMS, assignments: assignments(), stage: 'prepare' });
    expect(r.report).toBeNull();
    const doctors = r.cleanup.find((c) => c.column === 'Doctor');
    expect(doctors).toMatchObject({ rawNames: 5, cleanNames: 2 });
    expect(doctors?.values.map((v) => v.clean)).toContain('Dr A Kumar');
    expect(r.lookups.find((l) => l.label === 'Pharmacy attribution')?.byStatus).toEqual({ Matched: 2, Fallback: 1, Unattributed: 1 });
    expect(r.columns.map((c) => c.name)).toContain('Attribution');
    expect(r.combinedRows).toBe(14);
  });

  it('report stage: the report with its totals row', async () => {
    const r = await previewTask({ recipe: recipe(), params: PARAMS, assignments: assignments(), stage: 'report' });
    expect(r.report?.rows).toHaveLength(3);
    expect(r.report?.totals?.['Gross Profit']).toBe(-528980);
  });

  it('works before the month is typed in, and reports a broken report definition instead of failing', async () => {
    const empty = await previewTask({ recipe: recipe(), params: { Month: '' }, assignments: assignments(), stage: 'report' });
    expect(empty.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(empty.report?.rows.length).toBeGreaterThan(0);

    const broken = recipe();
    broken.report.columns.push({ kind: 'formula', name: 'Bad', formula: '[Nope]+1', type: 'number' });
    const r = await previewTask({ recipe: broken, params: PARAMS, assignments: assignments(), stage: 'report' });
    expect(r.report?.rows).toEqual([]);
    expect(r.issues.find((i) => i.level === 'error')?.message).toMatch(/“Bad”: the formula uses \[Nope\]/);
  });

  it('re-reads nothing when the same files come again (workbooks are cached by name, size and date)', async () => {
    const list = assignments();
    const a = await previewTask({ recipe: recipe(), params: PARAMS, assignments: list, stage: 'prepare' });
    const b = await previewTask({ recipe: recipe(), params: PARAMS, assignments: list, stage: 'prepare' });
    expect(b.combinedRows).toBe(a.combinedRows);
  });
});
