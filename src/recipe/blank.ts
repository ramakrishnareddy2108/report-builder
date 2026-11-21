import { newId } from '@/lib/id';
import type { DashboardTemplate } from '@/dashboard/schema';
import type { Recipe } from './schema';

/** An empty recipe the builder starts from. */
export function blankRecipe(name = 'New recipe'): Recipe {
  return {
    schemaVersion: 1,
    id: newId(),
    name,
    updatedAt: new Date().toISOString(),
    parameters: [{ name: 'Month', type: 'text', label: 'Report month (e.g. Oct-2026)' }],
    sources: [],
    cleanup: [],
    lookups: [],
    report: { groupBy: [], columns: [], totalsRow: true },
    output: { mode: 'plain', sheetName: 'Report', includeChecksSheet: true, includeCombinedSheet: false },
    checks: { tieOuts: [] },
  };
}

export function blankDashboard(name = 'New dashboard'): DashboardTemplate {
  return {
    schemaVersion: 1,
    id: newId(),
    name,
    requiredColumns: [],
    filters: [],
    tiles: [],
    updatedAt: new Date().toISOString(),
  };
}
