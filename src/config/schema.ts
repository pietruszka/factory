import { isAbsolute } from 'node:path';

import { z } from 'zod';

import { CompleteModelsSectionSchema, MODEL_ROLES } from './models.js';
import { normaliseOrigin } from './origin.js';

export const FLOWS = ['A', 'E', 'F', 'H'] as const;
export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn'] as const;
/** `linked`: a git worktree of the work repo. `standalone`: a local clone. Default `linked`. */
export const WORKTREE_MODES = ['linked', 'standalone'] as const;

const nonEmpty = z.string().min(1);
const globs = z.array(nonEmpty);

const FlowCapSchema = z.strictObject({
  usd: z.number().positive(),
  minutes: z.number().positive(),
  fix_loops: z.int().min(0),
});

const PriceSchema = z.strictObject({
  inputPer1M: z.number().min(0).nullable(),
  outputPer1M: z.number().min(0).nullable(),
  cacheReadPer1M: z.number().min(0).nullable(),
  cacheWritePer1M: z.number().min(0).nullable(),
});

// A secrets entry names where the value lives. It never holds the value itself.
const SecretRefSchema = z.union(
  [
    z.strictObject({ env: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'must be an environment variable name') }),
    z.strictObject({ keychain: nonEmpty }),
  ],
  { error: 'must be exactly one of { env: VARIABLE_NAME } or { keychain: item-name }' },
);

const ViewportSchema = z.strictObject({
  name: nonEmpty,
  width: z.int().min(1),
  height: z.int().min(1),
});

const port = z.int().min(1).max(65535);

const relativeInsideRepo = nonEmpty.refine(
  (value) => !isAbsolute(value) && !value.split(/[\\/]/).includes('..'),
  { error: 'must be a relative path inside the repo' },
);

/** Every key a config file may set, global or per-repo. Required-ness applies to the merged result. */
const CONFIG_SHAPE = {
  version: z.literal(1),
  models: CompleteModelsSectionSchema.partial(),
  caps: z.strictObject({
    A: FlowCapSchema,
    E: FlowCapSchema,
    F: FlowCapSchema,
    H: FlowCapSchema,
  }),
  rate_table: z.record(nonEmpty, PriceSchema),
  secrets: z.record(nonEmpty, SecretRefSchema),
  inspector: z.strictObject({
    host: nonEmpty,
    port: z.int().min(0).max(65535),
  }),
  dev_harness: z.strictObject({ repeats: z.int().min(1) }),

  base_branch: nonEmpty,
  package_manager: z.enum(PACKAGE_MANAGERS),
  install: nonEmpty,
  gates: z.strictObject({
    lint: nonEmpty,
    typecheck: nonEmpty,
    test: nonEmpty,
    build: nonEmpty.optional(),
    e2e: nonEmpty.nullable().optional(),
  }),
  protected_globs: globs,
  forbidden_globs: globs,
  role_write_globs: z.partialRecord(z.enum(MODEL_ROLES), globs),
  risk_tiers: z.record(nonEmpty, globs),
  snapshot_ignore: globs,
  pr_labels: globs,
  ui: z
    .strictObject({
      dev_server: nonEmpty,
      url: z.string().regex(/^https?:\/\/\S+$/, 'must be an http or https URL'),
      port,
      viewports: z.array(ViewportSchema),
    })
    .optional(),
  worktree: z.strictObject({ mode: z.enum(WORKTREE_MODES).optional() }).optional(),
  gates_cwd: relativeInsideRepo,
  timing_sensitive_repeats: z.int().min(1),
  timing_sensitive_globs: globs,
};

export const MergedConfigSchema = z.strictObject(CONFIG_SHAPE);

export type Config = z.infer<typeof MergedConfigSchema>;

export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** The values one config file may set. */
export type PartialConfig = DeepPartial<Config>;

/** Makes every key of every nested object optional. Arrays, records and leaves stay as they are. */
function deepPartial(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodOptional) {
    return deepPartial(schema.unwrap() as z.ZodType).optional();
  }
  if (schema instanceof z.ZodObject) {
    const shape = Object.fromEntries(
      Object.entries(schema.shape as Record<string, z.ZodType>).map(([key, value]) => [
        key,
        deepPartial(value).optional(),
      ]),
    );
    return z.strictObject(shape);
  }
  return schema;
}

const partialShape = Object.fromEntries(
  Object.entries(CONFIG_SHAPE).map(([key, value]) => [key, deepPartial(value).optional()]),
);

/** The global config.yaml: any config key, none required. */
export const GlobalFileSchema = z.strictObject(partialShape);

const MatchSchema = z
  .strictObject({
    origin: nonEmpty
      .refine((value) => normaliseOrigin(value) !== undefined, {
        error: 'must be an https://, http://, ssh:// or git@host:path URL',
      })
      .optional(),
    path: nonEmpty.refine((value) => isAbsolute(value), { error: 'must be an absolute path' }).optional(),
  })
  .refine((match) => match.origin !== undefined || match.path !== undefined, {
    error: 'must set origin or path',
  });

/** A per-repo file: the same keys as the global file, plus the `match` that selects the repo. */
export const RepoFileSchema = z.strictObject({ ...partialShape, match: MatchSchema });

export type RepoMatch = z.infer<typeof MatchSchema>;
export type RepoFile = PartialConfig & { match: RepoMatch };
