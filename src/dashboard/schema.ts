// A dashboard template: tiles over a report's output columns. Validated with Zod.
// The shape follows CLAUDE.md ("Dashboard template schema").

import { z } from 'zod';

const nonEmpty = z.string().trim().min(1, 'Required');

export const TileTypeSchema = z.enum(['kpi', 'bar', 'stackedBar', 'line', 'pie', 'table']);
export type TileType = z.infer<typeof TileTypeSchema>;

export const TileAggSchema = z.enum(['SUM', 'COUNT', 'AVG', 'MIN', 'MAX']);
export type TileAgg = z.infer<typeof TileAggSchema>;

export const TileSchema = z.object({
  id: nonEmpty,
  title: nonEmpty,
  type: TileTypeSchema,
  x: z.string().optional(),
  y: z.object({ column: nonEmpty, agg: TileAggSchema }),
  splitBy: z.string().optional(),
  /** Formula over the data rows. */
  filter: z.string().optional(),
  topN: z.number().int().min(1).optional(),
  sort: z.enum(['valueDesc', 'valueAsc', 'label']).optional(),
  /** e.g. { column: 'Month', mode: 'previous' } shows the change against the previous Month. */
  compare: z.object({ column: nonEmpty, mode: z.literal('previous') }).optional(),
});
export type Tile = z.infer<typeof TileSchema>;

export const DashboardTemplateSchema = z.object({
  schemaVersion: z.literal(1),
  id: nonEmpty,
  name: nonEmpty,
  recipeId: z.string().optional(),
  /** Checked against the loaded data. */
  requiredColumns: z.array(z.string()),
  filters: z.array(z.object({ column: nonEmpty, label: z.string() })),
  tiles: z.array(TileSchema),
  /** Added for the library list; ISO time of the last save. */
  updatedAt: z.string().optional(),
});
export type DashboardTemplate = z.infer<typeof DashboardTemplateSchema>;
