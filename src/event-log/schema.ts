import { z } from 'zod';

/** The schema version this build writes. Bump it together with a new entry in migrations.ts. */
export const SCHEMA_VERSION = 1;

/** Phase names, the terminal `passed`, and the stop names of the run state machine. */
export const RUN_STATUSES = [
  'preflight',
  'routing',
  'planning',
  'building',
  'gating',
  'verifying',
  'reviewing',
  'opening_pr',
  'awaiting_approval',
  'passed',
  'refused',
  'config_drift',
  'needs_human',
  'cannot_reproduce',
  'budget',
  'timeout',
  'cost_missing',
  'breach',
  'killed',
  'interrupted',
] as const;

/**
 * Statuses a run cannot be resumed from. Every other status still occupies the one active slot
 * of its repo and ticket. The `runs_one_active` index in migrations.ts lists the same three.
 */
export const NON_RESUMABLE_RUN_STATUSES = ['passed', 'refused', 'breach'] as const;

export const STEP_STATUSES = ['pending', 'running', 'done', 'failed'] as const;

export const OUTCOMES = ['accepted', 'accepted_with_edits', 'rejected', 'abandoned'] as const;

const text = z.string().min(1);
const isoTime = z.iso.datetime({ offset: true });

export const runSchema = z.strictObject({
  run_id: text,
  repo: text,
  ticket: text,
  flow: text,
  tier: text.optional(),
  status: z.enum(RUN_STATUSES),
  base_commit: text,
  config_hash: text,
  factory_version: text,
  started_at: isoTime,
  ended_at: isoTime.optional(),
  cap_usd_effective: z.number().finite().nonnegative().optional(),
});

export const stepSchema = z.strictObject({
  run_id: text,
  step: text,
  attempt: z.number().int().min(1).default(1),
  role: text.optional(),
  model: text.optional(),
  purpose: text.optional(),
  status: z.enum(STEP_STATUSES),
  exit_reason: text.optional(),
  input_hash: text.optional(),
  cli_session_id: text.optional(),
  started_at: isoTime.optional(),
  ended_at: isoTime.optional(),
});

export const eventSchema = z.strictObject({
  run_id: text,
  type: text,
  started_at: isoTime,
  step: text.optional(),
  attempt: z.number().int().min(1).optional(),
  role: text.optional(),
  model: text.optional(),
  purpose: text.optional(),
  ended_at: isoTime.optional(),
  status: text.optional(),
  input_tokens: z.number().finite().optional(),
  output_tokens: z.number().finite().optional(),
  cache_read_tokens: z.number().finite().optional(),
  cache_write_tokens: z.number().finite().optional(),
  reasoning_tokens: z.number().finite().optional(),
  cost_usd: z.number().finite().optional(),
  usage_source: z.enum(['reported', 'estimated']).optional(),
  context_used: z.number().int().nonnegative().optional(),
  context_window: z.number().int().nonnegative().optional(),
  payload: z.unknown().optional(),
});

export const checkRowSchema = z.strictObject({
  event_id: z.number().int().min(1),
  gate: text,
  item: text,
  ok: z.boolean(),
  note: z.string().optional(),
});

export const processSchema = z.strictObject({
  run_id: text,
  step: text,
  pid: z.number().int().min(1),
  command: text,
  started_at: isoTime,
});

export const approvalSchema = z.strictObject({
  run_id: text,
  plan_hash: text,
  hash_algo: text,
  approver: text,
  client: text,
  approved_at: isoTime,
});

export const shadowVerdictSchema = z.strictObject({
  run_id: text,
  plan_hash: text,
  would_approve: z.boolean(),
  rows: z.unknown().refine((value) => value !== undefined, 'rows is required'),
  created_at: isoTime,
});

export const outcomeSchema = z.strictObject({
  run_id: text,
  outcome: z.enum(OUTCOMES),
  reason: z.string().optional(),
  note: z.string().optional(),
  recorded_at: isoTime,
});

type WithOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/** `run_id` defaults to `deps.newId('run')`, `started_at` to the clock. */
export type RunInput = WithOptional<z.input<typeof runSchema>, 'run_id' | 'started_at'>;
/** `attempt` defaults to 1. */
export type StepInput = z.input<typeof stepSchema>;
/** `started_at` defaults to the clock. Free text belongs in `payload`. */
export type EventInput = WithOptional<z.input<typeof eventSchema>, 'started_at'>;
export type CheckRowInput = Omit<z.input<typeof checkRowSchema>, 'event_id'>;
/** `started_at` defaults to the clock. */
export type ProcessInput = WithOptional<z.input<typeof processSchema>, 'started_at'>;
/** `hash_algo` defaults to `sha256`, `approved_at` to the clock. */
export type ApprovalInput = WithOptional<z.input<typeof approvalSchema>, 'hash_algo' | 'approved_at'>;
/** `created_at` defaults to the clock. `rows` is any JSON-serialisable value. */
export type ShadowVerdictInput = WithOptional<z.input<typeof shadowVerdictSchema>, 'created_at'>;
/** `recorded_at` defaults to the clock. */
export type OutcomeInput = WithOptional<z.input<typeof outcomeSchema>, 'recorded_at'>;

export type RunStatus = (typeof RUN_STATUSES)[number];
