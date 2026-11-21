// Zod schemas for every persisted JSON file.
//
// Each file has a `version` field. Bump SCHEMA_VERSION (and add a migration)
// when a persisted shape changes incompatibly.

import { z } from 'zod';
import { normaliseLabel } from './doctors';
import { getMeasure } from './measures';
import {
  COST_MEASURE_CODES,
  FIELD_KEYS,
  MEASURE_CODES,
  RULE_FLAG_KEYS,
  SOURCE_IDS,
  type CheckResult,
  type CostEntry,
  type DoctorMaster,
  type FactRow,
  type FieldMapping,
  type MeasureRule,
  type NameGroup,
  type RuleTerm,
  type RunInfo,
  type SourceMapping,
} from './types';

export const SCHEMA_VERSION = 1 as const;
const version = z.literal(SCHEMA_VERSION);

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

export const MonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must look like 2026-10');

const IsoDate = z.iso.date();
const IsoDateTime = z.iso.datetime({ offset: true });
const Paise = z.int(); // safe integer
const NonEmpty = z.string().trim().min(1, 'Must not be empty');
const ExcelRow = z.int().min(1);

export const SourceIdSchema = z.enum(SOURCE_IDS);
export const FieldKeySchema = z.enum(FIELD_KEYS);
export const MeasureCodeSchema = z.enum(MEASURE_CODES);
export const CostMeasureCodeSchema = z.enum(COST_MEASURE_CODES);
export const RuleFlagKeySchema = z.enum(RULE_FLAG_KEYS);

function addDuplicateIssues<T>(
  ctx: z.RefinementCtx,
  items: readonly T[],
  key: (item: T) => string,
  path: string,
  label: string,
): void {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const k = key(item);
    if (seen.has(k)) {
      ctx.addIssue({ code: 'custom', message: `Duplicate ${label}: ${k}`, path: [path, i] });
    }
    seen.add(k);
  });
}

// ---------------------------------------------------------------------------
// settings/sources.json
// ---------------------------------------------------------------------------

export const FieldMappingSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('column'),
    value: NonEmpty,
    by: z.enum(['header', 'letter']).optional(),
    occurrence: z.int().min(1).optional(),
  }),
  z.object({ type: z.literal('fixed'), value: z.union([z.string(), z.number()]) }),
  z.object({ type: z.literal('formula'), value: NonEmpty }),
  z.object({ type: z.literal('none'), value: z.null() }),
]);

export const SourceMappingSchema = z.object({
  sourceId: SourceIdSchema,
  sheet: NonEmpty,
  headerRow: ExcelRow,
  namePattern: NonEmpty,
  fields: z.partialRecord(FieldKeySchema, FieldMappingSchema),
  rowFilter: z.string().nullable(),
  refUnique: z.boolean(),
});

export const SourcesFileSchema = z
  .object({ version, sources: z.array(SourceMappingSchema) })
  .superRefine((file, ctx) =>
    addDuplicateIssues(ctx, file.sources, (s) => s.sourceId, 'sources', 'source'),
  );

// ---------------------------------------------------------------------------
// settings/doctors.json
// ---------------------------------------------------------------------------

export const DoctorMasterSchema = z.object({
  id: NonEmpty,
  displayName: NonEmpty,
  department: z.string().nullable(),
  aliases: z.array(z.string()),
});

export const NameGroupSchema = z.object({ name: NonEmpty, aliases: z.array(z.string()) });

/** Departments or sponsors: each name or alias belongs to one group only. */
function addGroupIssues(ctx: z.RefinementCtx, groups: readonly NameGroup[], path: string, label: string): void {
  const owner = new Map<string, string>();
  groups.forEach((g, i) => {
    for (const name of [g.name, ...g.aliases]) {
      const key = normaliseLabel(name);
      const other = owner.get(key);
      if (other !== undefined && other !== g.name) {
        ctx.addIssue({
          code: 'custom',
          message: `"${name}" is used by both ${label} "${other}" and "${g.name}"`,
          path: [path, i],
        });
      }
      owner.set(key, g.name);
    }
  });
}

export const DoctorsFileSchema = z
  .object({
    version,
    doctors: z.array(DoctorMasterSchema),
    // Older files have no groups yet.
    departments: z.array(NameGroupSchema).default([]),
    sponsors: z.array(NameGroupSchema).default([]),
  })
  .superRefine((file, ctx) => {
    addDuplicateIssues(ctx, file.doctors, (d) => d.id, 'doctors', 'doctor id');
    // An alias may belong to one doctor only, ignoring case and outer spaces.
    const owner = new Map<string, string>();
    file.doctors.forEach((d, i) => {
      for (const alias of d.aliases) {
        const k = alias.trim().toUpperCase();
        const other = owner.get(k);
        if (other !== undefined && other !== d.id) {
          ctx.addIssue({
            code: 'custom',
            message: `Alias "${alias}" is used by both ${other} and ${d.id}`,
            path: ['doctors', i, 'aliases'],
          });
        }
        owner.set(k, d.id);
      }
    });
    addGroupIssues(ctx, file.departments, 'departments', 'department');
    addGroupIssues(ctx, file.sponsors, 'sponsors', 'sponsor');
  });

// ---------------------------------------------------------------------------
// settings/rules.json
// ---------------------------------------------------------------------------

export const RuleValueSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('count') }),
  z.object({ type: z.literal('field'), field: FieldKeySchema }),
  z.object({ type: z.literal('formula'), formula: NonEmpty }),
]);

export const RuleTermSchema = z.object({
  sourceId: SourceIdSchema,
  value: RuleValueSchema,
  filter: z.string().nullable(),
  sign: z.union([z.literal(1), z.literal(-1)]),
  attribution: z.enum(['sourceDoctor', 'pharmacyByUmrno']),
  onlyIf: z.object({ flag: RuleFlagKeySchema, is: z.boolean() }).optional(),
  note: z.string().optional(),
});

export const MeasureRuleSchema = z.discriminatedUnion('kind', [
  z.object({
    measure: MeasureCodeSchema,
    kind: z.literal('source'),
    terms: z.array(RuleTermSchema).min(1, 'A source rule needs at least one term'),
  }),
  z.object({ measure: MeasureCodeSchema, kind: z.literal('costs') }),
]);

export const RuleFlagsSchema = z.object({
  includePendingIpBills: z.boolean(),
  includeConsultations: z.boolean(),
});

/** When a doctor or department moving against the previous Final month is worth a warning. */
export const CheckThresholdsSchema = z.object({
  /** Warn when Total Revenue moves by more than this many percent. */
  changePercent: z.number().min(1).max(10_000).default(50),
  /** Ignore moves where both months are below this amount (integer paise), so tiny doctors do not make noise. */
  minChangePaise: z.int().min(0).default(100_000),
});

export const RulesFileSchema = z
  .object({
    version,
    flags: RuleFlagsSchema,
    // Older files have no thresholds yet.
    thresholds: CheckThresholdsSchema.default({ changePercent: 50, minChangePaise: 100_000 }),
    rules: z.array(MeasureRuleSchema),
  })
  .superRefine((file, ctx) => {
    addDuplicateIssues(ctx, file.rules, (r) => r.measure, 'rules', 'rule for measure');
    const present = new Set(file.rules.map((r) => r.measure));

    file.rules.forEach((rule, i) => {
      const def = getMeasure(rule.measure);
      const path = ['rules', i];
      if (def.origin === 'calc') {
        ctx.addIssue({
          code: 'custom',
          message: `${rule.measure} is calculated from other measures and cannot have a rule`,
          path,
        });
        return;
      }
      if (def.origin !== rule.kind) {
        ctx.addIssue({
          code: 'custom',
          message: `${rule.measure} must be a "${def.origin}" rule, not "${rule.kind}"`,
          path: [...path, 'kind'],
        });
        return;
      }
      if (rule.kind === 'source') {
        rule.terms.forEach((term, j) => {
          const isCount = term.value.type === 'count';
          if (isCount !== (def.kind === 'count')) {
            ctx.addIssue({
              code: 'custom',
              message:
                def.kind === 'count'
                  ? `${rule.measure} is a count; its value must be "count"`
                  : `${rule.measure} is money; its value must be a field or formula`,
              path: [...path, 'terms', j, 'value'],
            });
          }
        });
      }
    });

    // Each non-calc measure has exactly one rule.
    for (const code of MEASURE_CODES) {
      if (getMeasure(code).origin !== 'calc' && !present.has(code)) {
        ctx.addIssue({ code: 'custom', message: `Missing rule for ${code}`, path: ['rules'] });
      }
    }
  });

// ---------------------------------------------------------------------------
// settings/costs-defaults.json and data/<month>/run-<n>/costs.json
// ---------------------------------------------------------------------------

export const CostEntrySchema = z.object({
  doctorId: NonEmpty,
  amounts: z.partialRecord(CostMeasureCodeSchema, Paise),
  note: z.string().optional(),
});

const costEntries = z
  .array(CostEntrySchema)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    entries.forEach((e, i) => {
      if (seen.has(e.doctorId)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate doctor: ${e.doctorId}`, path: [i] });
      }
      seen.add(e.doctorId);
    });
  });

export const CostsDefaultsFileSchema = z.object({ version, entries: costEntries });

export const CostsFileSchema = z.object({
  version,
  month: MonthSchema,
  operatorName: z.string(),
  updatedAt: IsoDateTime,
  entries: costEntries,
});

// ---------------------------------------------------------------------------
// data/<month>/run-<n>/facts.json
// ---------------------------------------------------------------------------

// Strict: an unexpected key (a patient name, for example) is rejected, not stripped.
export const FactRowSchema = z
  .strictObject({
    month: MonthSchema,
    measure: MeasureCodeSchema,
    amountPaise: Paise,
    doctorId: z.string().nullable(),
    departmentId: z.string().nullable(),
    sponsor: z.string().nullable(),
    sourceId: SourceIdSchema,
    sourceFile: NonEmpty,
    sourceRow: ExcelRow,
    ref: z.string().nullable(),
    umrno: z.string().nullable(),
    txnDate: IsoDate.nullable(),
    attributionMethod: z.string().optional(),
    attributionStatus: z.enum(['Matched', 'Fallback', 'Unattributed']).optional(),
  })
  .superRefine((row, ctx) => {
    if (getMeasure(row.measure).origin !== 'source') {
      ctx.addIssue({
        code: 'custom',
        message: `${row.measure} does not come from a source file, so it cannot be a fact row`,
        path: ['measure'],
      });
    }
  });

export const FactsFileSchema = z.object({
  version,
  month: MonthSchema,
  runNumber: z.int().min(1),
  facts: z.array(FactRowSchema),
});

// ---------------------------------------------------------------------------
// data/<month>/run-<n>/checks.json
// ---------------------------------------------------------------------------

export const CheckResultSchema = z.object({
  id: NonEmpty,
  level: z.enum(['Pass', 'Warning', 'Fail']),
  title: NonEmpty,
  message: z.string(),
  rows: z.int().min(0).optional(),
  amountPaise: Paise.optional(),
  examples: z.array(
    z.object({ sourceFile: z.string(), sourceRow: ExcelRow, ref: z.string().nullable() }),
  ),
  details: z.array(z.string()).optional(),
  note: z.string().optional(),
});

export const ChecksFileSchema = z.object({
  version,
  month: MonthSchema,
  runNumber: z.int().min(1),
  checks: z.array(CheckResultSchema),
});

// ---------------------------------------------------------------------------
// data/<month>/run-<n>/run-info.json
// ---------------------------------------------------------------------------

export const RunInfoSchema = z
  .object({
    version,
    month: MonthSchema,
    runNumber: z.int().min(1),
    kind: z.enum(['run', 'summary']).optional(),
    status: z.enum(['Draft', 'Final']),
    createdAt: IsoDateTime,
    finalizedAt: IsoDateTime.optional(),
    operatorName: z.string(),
    reason: z.string().nullable(),
    files: z.array(
      z.object({
        sourceId: SourceIdSchema,
        fileName: NonEmpty,
        sizeBytes: z.int().min(0),
        sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Must be a lowercase SHA-256 hex string'),
      }),
    ),
  })
  .superRefine((info, ctx) => {
    if (info.status === 'Final' && !info.finalizedAt) {
      ctx.addIssue({ code: 'custom', message: 'A Final run needs finalizedAt', path: ['finalizedAt'] });
    }
  });

// ---------------------------------------------------------------------------
// data/<month>/run-<n>/summary.json (a past month imported from a filled DRR)
// ---------------------------------------------------------------------------

export const SummaryFileSchema = z.object({
  version,
  month: MonthSchema,
  runNumber: z.int().min(1),
  /** Name of the workbook it was read from. */
  sourceFile: NonEmpty,
  rows: z.array(
    z.object({
      name: NonEmpty,
      department: z.string(),
      // Integer paise for money, plain numbers for counts.
      values: z.partialRecord(MeasureCodeSchema, Paise),
    }),
  ),
});

// ---------------------------------------------------------------------------
// data/<month>/run-<n>/settings-used.json
// ---------------------------------------------------------------------------

export const SettingsUsedFileSchema = z.object({
  version,
  sources: SourcesFileSchema,
  doctors: DoctorsFileSchema,
  rules: RulesFileSchema,
  costsDefaults: CostsDefaultsFileSchema.nullable(),
});

// ---------------------------------------------------------------------------
// settings/dashboards.json
// ---------------------------------------------------------------------------

export const DIMENSIONS = ['month', 'doctor', 'department', 'sponsor'] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export const DIMENSION_LABELS: Readonly<Record<Dimension, string>> = {
  month: 'Month',
  doctor: 'Doctor',
  department: 'Department',
  sponsor: 'Sponsor',
};

export const TILE_TYPES = ['kpi', 'bar', 'stackedBar', 'line', 'pie', 'table'] as const;
export type TileType = (typeof TILE_TYPES)[number];
export const TILE_TYPE_LABELS: Readonly<Record<TileType, string>> = {
  kpi: 'Number (KPI)',
  bar: 'Bar chart',
  stackedBar: 'Stacked bar chart',
  line: 'Line chart',
  pie: 'Pie chart',
  table: 'Table',
};

export const AGGREGATIONS = ['sum', 'count', 'avg'] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];
export const COMPARISONS = ['none', 'previousMonth', 'sameMonthLastYear'] as const;
export type Comparison = (typeof COMPARISONS)[number];
export const SORTS = ['desc', 'asc', 'name'] as const;
export type SortOrder = (typeof SORTS)[number];

const NameList = z.array(NonEmpty);

export const TileFiltersSchema = z.object({ doctors: NameList, departments: NameList, sponsors: NameList });

export const TileSchema = z
  .object({
    id: NonEmpty,
    title: NonEmpty,
    type: z.enum(TILE_TYPES),
    x: z.enum(DIMENSIONS),
    /** Several measures draw one series each (for example IP, OP and pharmacy revenue). */
    measures: z.array(MeasureCodeSchema).min(1, 'Choose at least one measure'),
    agg: z.enum(AGGREGATIONS),
    split: z.enum(DIMENSIONS).nullable(),
    filters: TileFiltersSchema,
    /** Keep only this many categories (by size); null keeps all. */
    topN: z.int().min(1).max(100).nullable(),
    sort: z.enum(SORTS),
    compare: z.enum(COMPARISONS),
  })
  .superRefine((tile, ctx) => {
    if (tile.split !== null && tile.split === tile.x) {
      ctx.addIssue({ code: 'custom', message: 'Split by must differ from the X axis', path: ['split'] });
    }
    if (tile.split !== null && tile.measures.length > 1) {
      ctx.addIssue({ code: 'custom', message: 'Split by needs a single measure', path: ['split'] });
    }
  });

export const MonthRangeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  /** The newest Final month; follows new months automatically. */
  z.object({ mode: z.literal('latest') }),
  z.object({ mode: z.literal('last'), count: z.int().min(1).max(60) }),
  z.object({ mode: z.literal('range'), from: MonthSchema, to: MonthSchema }),
]);

export const DashboardSchema = z
  .object({
    id: NonEmpty,
    name: NonEmpty,
    /** Global filters: the months, and optionally one department list and sponsor list for every tile. */
    months: MonthRangeSchema,
    departments: NameList,
    sponsors: NameList,
    tiles: z.array(TileSchema),
  })
  .superRefine((d, ctx) => {
    addDuplicateIssues(ctx, d.tiles, (t) => t.id, 'tiles', 'tile id');
    if (d.months.mode === 'range' && d.months.from > d.months.to) {
      ctx.addIssue({ code: 'custom', message: 'The first month must not be after the last', path: ['months'] });
    }
  });

export const DashboardsFileSchema = z.object({ version, dashboards: z.array(DashboardSchema) }).superRefine((file, ctx) => {
  addDuplicateIssues(ctx, file.dashboards, (d) => d.id, 'dashboards', 'dashboard id');
});

// ---------------------------------------------------------------------------
// backup-info.json (root of a backup zip)
// ---------------------------------------------------------------------------

export const BACKUP_APP_ID = 'drr-report-builder' as const;

export const BackupManifestSchema = z.object({
  version,
  app: z.literal(BACKUP_APP_ID),
  createdAt: IsoDateTime,
  workspaceName: z.string(),
  files: z.array(NonEmpty),
});

// ---------------------------------------------------------------------------
// Inferred file types
// ---------------------------------------------------------------------------

export type SourcesFile = z.infer<typeof SourcesFileSchema>;
export type DoctorsFile = z.infer<typeof DoctorsFileSchema>;
export type RulesFile = z.infer<typeof RulesFileSchema>;
export type CostsDefaultsFile = z.infer<typeof CostsDefaultsFileSchema>;
export type CostsFile = z.infer<typeof CostsFileSchema>;
export type FactsFile = z.infer<typeof FactsFileSchema>;
export type ChecksFile = z.infer<typeof ChecksFileSchema>;
export type RunInfoFile = z.infer<typeof RunInfoSchema>;
export type SummaryFile = z.infer<typeof SummaryFileSchema>;
export type SettingsUsedFile = z.infer<typeof SettingsUsedFileSchema>;
export type DashboardsFile = z.infer<typeof DashboardsFileSchema>;
export type Dashboard = z.infer<typeof DashboardSchema>;
export type Tile = z.infer<typeof TileSchema>;
export type MonthRange = z.infer<typeof MonthRangeSchema>;
export type BackupManifest = z.infer<typeof BackupManifestSchema>;

// ---------------------------------------------------------------------------
// Compile-time check: schemas and the hand-written types in types.ts agree.
// ---------------------------------------------------------------------------

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type SchemaTypeChecks = [
  Assert<Same<z.infer<typeof FieldMappingSchema>, FieldMapping>>,
  Assert<Same<z.infer<typeof SourceMappingSchema>, SourceMapping>>,
  Assert<Same<z.infer<typeof DoctorMasterSchema>, DoctorMaster>>,
  Assert<Same<z.infer<typeof NameGroupSchema>, NameGroup>>,
  Assert<Same<z.infer<typeof RuleTermSchema>, RuleTerm>>,
  Assert<Same<z.infer<typeof MeasureRuleSchema>, MeasureRule>>,
  Assert<Same<z.infer<typeof CostEntrySchema>, CostEntry>>,
  Assert<Same<z.infer<typeof FactRowSchema>, FactRow>>,
  Assert<Same<z.infer<typeof CheckResultSchema>, CheckResult>>,
  Assert<Same<Omit<RunInfoFile, 'version'>, RunInfo>>,
];
