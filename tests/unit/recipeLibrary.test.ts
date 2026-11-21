import { describe, expect, it } from 'vitest';
import { blankDashboard, blankRecipe } from '@/recipe/blank';
import { buildLibraryFile, libraryFileName, planImport } from '@/recipe/importExport';
import { createLibrary, memoryStore } from '@/recipe/library';
import { RecipeSchema, type Recipe } from '@/recipe/schema';
import { DashboardTemplateSchema } from '@/dashboard/schema';

function sampleRecipe(name = 'DRR'): Recipe {
  const r = blankRecipe(name);
  r.sources.push({
    id: 'opBilling',
    label: 'OP Billing',
    required: true,
    match: { namePattern: 'OP Billing Report', requiredHeaders: ['BILLNO'] },
    sheet: { name: 'Sheet1' },
    headerRow: 3,
    columns: [{ from: 'NETAMOUNT', as: 'Amount', type: 'money' }],
    rowFilter: 'NOT(ISBLANK([BILLNO]))',
    calculated: [],
  });
  r.report.columns.push({ kind: 'serial', name: 'S.No.' }, { kind: 'aggregate', name: 'Revenue', agg: 'SUM', of: 'Amount', type: 'money' });
  return r;
}

describe('recipe schema', () => {
  it('accepts a blank recipe and a filled one', () => {
    expect(RecipeSchema.safeParse(blankRecipe()).success).toBe(true);
    expect(RecipeSchema.safeParse(sampleRecipe()).success).toBe(true);
  });

  it('accepts template output and rejects an unknown column type', () => {
    const r = sampleRecipe();
    r.output = { mode: 'template', templateName: 'DRR Format.xlsx', templateBase64: '', headerRow: 'auto', keepTemplateFormulas: true, includeChecksSheet: true, includeCombinedSheet: false };
    expect(RecipeSchema.safeParse(r).success).toBe(true);
    const bad = structuredClone(r) as unknown as { sources: { columns: { type: string }[] }[] };
    bad.sources[0]!.columns[0]!.type = 'currency';
    expect(RecipeSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a wrong schemaVersion, a blank name and an unknown report column kind', () => {
    expect(RecipeSchema.safeParse({ ...blankRecipe(), schemaVersion: 2 }).success).toBe(false);
    expect(RecipeSchema.safeParse({ ...blankRecipe(), name: '  ' }).success).toBe(false);
    const r = sampleRecipe() as unknown as { report: { columns: unknown[] } };
    r.report.columns.push({ kind: 'magic', name: 'X' });
    expect(RecipeSchema.safeParse(r).success).toBe(false);
  });

  it('validates dashboard templates', () => {
    const d = blankDashboard();
    d.tiles.push({ id: 't1', title: 'Revenue', type: 'kpi', y: { column: 'Total Revenue', agg: 'SUM' } });
    expect(DashboardTemplateSchema.safeParse(d).success).toBe(true);
    d.tiles.push({ id: 't2', title: 'Bad', type: 'radar' as never, y: { column: 'X', agg: 'SUM' } });
    expect(DashboardTemplateSchema.safeParse(d).success).toBe(false);
  });
});

describe('library storage', () => {
  it('saves, lists, duplicates and deletes recipes and dashboards', async () => {
    const lib = createLibrary(memoryStore());
    const saved = await lib.saveRecipe(sampleRecipe('DRR'));
    expect((await lib.listRecipes()).map((r) => r.name)).toEqual(['DRR']);

    const copy = await lib.duplicateRecipe(saved.id);
    expect(copy?.name).toBe('DRR (copy)');
    expect(copy?.id).not.toBe(saved.id);
    expect(await lib.listRecipes()).toHaveLength(2);

    await lib.deleteRecipe(saved.id);
    expect((await lib.listRecipes()).map((r) => r.id)).toEqual([copy?.id]);

    const d = await lib.saveDashboard(blankDashboard('Review'));
    expect((await lib.duplicateDashboard(d.id))?.name).toBe('Review (copy)');
    await lib.deleteDashboard(d.id);
    expect(await lib.listDashboards()).toHaveLength(1);
  });

  it('skips stored items that no longer validate instead of failing', async () => {
    const store = memoryStore();
    await store.set('recipe:old', { schemaVersion: 0, id: 'old' });
    const lib = createLibrary(store);
    await lib.saveRecipe(sampleRecipe());
    expect(await lib.listRecipes()).toHaveLength(1);
    expect(await lib.getRecipe('old')).toBeNull();
  });
});

describe('export and import', () => {
  it('names the file report-library-YYYYMMDD.json', () => {
    expect(libraryFileName(new Date(2026, 10, 5))).toBe('report-library-20261105.json');
  });

  it('round-trips: an exported library imports as all-new into an empty one', () => {
    const file = buildLibraryFile([sampleRecipe()], [blankDashboard()], new Date('2026-11-05T00:00:00Z'));
    const plan = planImport(JSON.stringify(file), { recipes: [], dashboards: [] });
    expect(plan.ok && plan.counts).toEqual({ new: 2, overwrite: 0, invalid: 0, removed: 0 });
  });

  it('merge overwrites same ids, keeps everything else', () => {
    const a = sampleRecipe('A');
    const keep = sampleRecipe('Keep');
    const text = JSON.stringify(buildLibraryFile([{ ...a, name: 'A v2' }], []));
    const plan = planImport(text, { recipes: [a, keep], dashboards: [] }, 'merge');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.items.map((i) => i.status)).toEqual(['overwrite']);
    expect(plan.removeRecipeIds).toEqual([]);
  });

  it('replace removes what is not in the file', () => {
    const a = sampleRecipe('A');
    const gone = sampleRecipe('Gone');
    const text = JSON.stringify(buildLibraryFile([a], []));
    const plan = planImport(text, { recipes: [a, gone], dashboards: [] }, 'replace');
    expect(plan.ok && plan.removeRecipeIds).toEqual([gone.id]);
    expect(plan.ok && plan.counts.removed).toBe(1);
  });

  it('reports invalid items by name and still imports the good ones', () => {
    const good = sampleRecipe('Good');
    const text = JSON.stringify({ schemaVersion: 1, exportedAt: 'x', recipes: [good, { id: 'b', name: 'Broken', schemaVersion: 1 }], dashboards: [] });
    const plan = planImport(text, { recipes: [], dashboards: [] });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.counts).toMatchObject({ new: 1, invalid: 1 });
    const bad = plan.items.find((i) => i.status === 'invalid');
    expect(bad?.name).toBe('Broken');
    expect(bad?.error).toBeTruthy();
  });

  it('refuses bad files, and never lets a useless file wipe the library in Replace mode', () => {
    const existing = { recipes: [sampleRecipe()], dashboards: [] };
    expect(planImport('not json', existing)).toMatchObject({ ok: false });
    expect(planImport('{"hello":1}', existing)).toMatchObject({ ok: false });
    expect(planImport(JSON.stringify({ schemaVersion: 1, recipes: [{ nope: true }], dashboards: [] }), existing, 'replace')).toMatchObject({ ok: false });
    expect(planImport(JSON.stringify({ schemaVersion: 1, recipes: [], dashboards: [] }), existing, 'replace')).toMatchObject({ ok: false });
  });

  it('applies a plan to the library', async () => {
    const lib = createLibrary(memoryStore());
    const gone = await lib.saveRecipe(sampleRecipe('Gone'));
    const keep = sampleRecipe('Keep');
    const plan = planImport(JSON.stringify(buildLibraryFile([keep], [blankDashboard('D')])), { recipes: [gone], dashboards: [] }, 'replace');
    if (!plan.ok) throw new Error('plan should be ok');
    await lib.applyImport(plan);
    expect((await lib.listRecipes()).map((r) => r.name)).toEqual(['Keep']);
    expect((await lib.listDashboards()).map((d) => d.name)).toEqual(['D']);
  });
});
