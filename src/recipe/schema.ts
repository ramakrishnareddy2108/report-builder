// A recipe is plain data (JSON), validated with Zod. The engine reads it; the UI only edits it.
// The shape follows CLAUDE.md ("Recipe schema").

import { z } from 'zod';

export const ColumnTypeSchema = z.enum(['text', 'number', 'money', 'date']);
export type ColumnType = z.infer<typeof ColumnTypeSchema>;

const nonEmpty = z.string().trim().min(1, 'Required');

export const ParameterSchema = z.object({
  name: nonEmpty, //                                         e.g. 'Month'
  type: z.enum(['text', 'number', 'date']),
  label: z.string(), //                                      e.g. 'Report month (e.g. Oct-2026)'
  default: z.string().optional(),
});
export type Parameter = z.infer<typeof ParameterSchema>;

export const SourceColumnSchema = z.object({
  from: nonEmpty, //   header text, or a column letter such as "AS"
  as: nonEmpty, //     the common name used across sources
  type: ColumnTypeSchema,
});

export const CalculatedColumnSchema = z.object({
  as: nonEmpty,
  formula: nonEmpty,
  type: ColumnTypeSchema,
});

export const SourceDefSchema = z.object({
  id: nonEmpty, //       e.g. 'opPharmacy'
  label: nonEmpty, //    e.g. 'OP Pharmacy'
  required: z.boolean(),
  /** Used to auto-assign uploaded files to this source. */
  match: z.object({
    namePattern: z.string().optional(),
    requiredHeaders: z.array(z.string()),
  }),
  sheet: z.object({ name: z.string().optional(), index: z.number().int().min(0).optional() }),
  headerRow: z.union([z.number().int().min(1), z.literal('auto')]),
  columns: z.array(SourceColumnSchema),
  /** Formula over the ORIGINAL headers; TRUE = keep the row. */
  rowFilter: z.string().optional(),
  calculated: z.array(CalculatedColumnSchema),
  /**
   * Duplicate-ID check: the (original or renamed) column that must hold each value once, for example
   * 'Ref'. Leave it out for line-item files that repeat the bill number on purpose.
   */
  uniqueColumn: z.string().optional(),
});
export type SourceDef = z.infer<typeof SourceDefSchema>;

export const CleanupRuleSchema = z.object({
  column: nonEmpty, // a combined column, e.g. 'Doctor'
  normalize: z.object({
    trim: z.literal(true),
    collapseSpaces: z.literal(true),
    ignoreCase: z.boolean(),
    removeChars: z.string(), // e.g. '.,'
  }),
  displayCase: z.enum(['asIs', 'upper', 'title']),
  aliases: z.array(z.object({ to: nonEmpty, from: z.array(z.string()) })),
});
export type CleanupRule = z.infer<typeof CleanupRuleSchema>;

export const LookupRuleSchema = z.object({
  label: nonEmpty,
  /** Fills `column` on the rows of `source`. */
  target: z.object({ source: nonEmpty, column: nonEmpty, key: nonEmpty, date: z.string().optional() }),
  from: z.object({
    source: nonEmpty,
    key: nonEmpty,
    value: nonEmpty,
    date: z.string().optional(),
    extraValues: z.array(z.object({ from: nonEmpty, as: nonEmpty })).optional(),
  }),
  /** Formula on the target row, e.g. ISBLANK([AdmissionNo]). */
  onlyWhen: z.string().optional(),
  pick: z.enum(['single', 'latestOnOrBefore', 'first']),
  notFoundValue: z.string(),
  /** e.g. 'Attribution' -> Matched | Fallback | Unattributed */
  writeStatusColumn: z.string().optional(),
});
export type LookupRule = z.infer<typeof LookupRuleSchema>;

export const AggregateFnSchema = z.enum(['SUM', 'COUNT', 'COUNTDISTINCT', 'AVG', 'MIN', 'MAX']);
export type AggregateFn = z.infer<typeof AggregateFnSchema>;

export const ReportColumnSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('group'), name: nonEmpty, from: nonEmpty }),
  z.object({
    kind: z.literal('aggregate'),
    name: nonEmpty,
    agg: AggregateFnSchema,
    of: z.string().optional(),
    /** Formula on combined rows, e.g. [Source]="OP Pharmacy". */
    where: z.string().optional(),
    type: ColumnTypeSchema,
  }),
  z.object({ kind: z.literal('formula'), name: nonEmpty, formula: nonEmpty, type: ColumnTypeSchema }),
  z.object({ kind: z.literal('serial'), name: nonEmpty }),
]);
export type ReportColumn = z.infer<typeof ReportColumnSchema>;

export const ReportDefSchema = z.object({
  groupBy: z.array(nonEmpty),
  columns: z.array(ReportColumnSchema),
  sort: z.array(z.object({ column: nonEmpty, dir: z.enum(['asc', 'desc']) })).optional(),
  totalsRow: z.boolean(),
});
export type ReportDef = z.infer<typeof ReportDefSchema>;

export const OutputDefSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('plain'),
    sheetName: nonEmpty,
    includeChecksSheet: z.boolean(),
    includeCombinedSheet: z.boolean(),
  }),
  z.object({
    mode: z.literal('template'),
    templateName: z.string(),
    /** The .xlsx template, stored inside the recipe. Empty until the user uploads it. */
    templateBase64: z.string(),
    sheetName: z.string().optional(),
    headerRow: z.union([z.number().int().min(1), z.literal('auto')]),
    keepTemplateFormulas: z.boolean(),
    includeChecksSheet: z.boolean(),
    includeCombinedSheet: z.boolean(),
  }),
]);
export type OutputDef = z.infer<typeof OutputDefSchema>;

export const TieOutSchema = z.object({
  label: nonEmpty,
  source: nonEmpty,
  /** Column of the source (its footer / total row is compared with the report). */
  column: nonEmpty,
  reportColumn: nonEmpty,
  tolerance: z.number().min(0),
});
export type TieOut = z.infer<typeof TieOutSchema>;

export const RecipeSchema = z.object({
  schemaVersion: z.literal(1),
  id: nonEmpty,
  name: nonEmpty,
  description: z.string().optional(),
  updatedAt: z.string(),
  parameters: z.array(ParameterSchema),
  sources: z.array(SourceDefSchema),
  cleanup: z.array(CleanupRuleSchema),
  lookups: z.array(LookupRuleSchema),
  report: ReportDefSchema,
  output: OutputDefSchema,
  checks: z.object({ tieOuts: z.array(TieOutSchema) }),
});
export type Recipe = z.infer<typeof RecipeSchema>;

/** Plain-language lines for a failed validation: "sources.0.label: Required". */
export function describeIssues(error: z.ZodError, limit = 5): string {
  const lines = error.issues.slice(0, limit).map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message));
  const more = error.issues.length - lines.length;
  return more > 0 ? `${lines.join('; ')}; and ${more} more` : lines.join('; ');
}
