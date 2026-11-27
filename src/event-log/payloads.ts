import { z } from 'zod';

import { WORKTREE_MODES } from '../config/schema.js';
import { FactoryError } from '../platform/errors.js';
import { RUN_STATUSES } from './schema.js';

const text = z.string().min(1);
const treeResult = z.enum(['killed', 'pid_reused', 'gone']);
const processEntry = z.strictObject({
  pid: z.number().int().min(1),
  term: treeResult,
  kill: treeResult.nullable(),
});

/** Payload schemas for event types the product writes. Other types still take any JSON. */
export const EVENT_PAYLOAD_SCHEMAS = {
  worktree_created: z.strictObject({
    path: text,
    base_commit: text,
    mode: z.enum(WORKTREE_MODES),
    allowed_paths: z.array(z.string()).optional(),
  }),
  worktree_removed: z.strictObject({
    path: text,
    mode: z.enum(WORKTREE_MODES),
  }),
  worktree_install: z.strictObject({
    path: text,
    exit_code: z.number().int().nullable(),
  }),
  run_status: z.strictObject({
    from: z.enum(RUN_STATUSES),
    to: z.enum(RUN_STATUSES),
  }),
  loop: z.strictObject({
    kind: z.enum(['fix', 'verify_fail', 'revision']),
  }),
  run_stop: z.strictObject({
    next: text,
    fields: z.array(z.string()).optional(),
    spentUsd: z.number().finite().optional(),
    elapsedMs: z.number().finite().optional(),
  }),
  draft_pr: z.strictObject({
    number: z.number().int().min(1),
  }),
  retention_cleaned: z.strictObject({
    run_folder: text,
    paths: z.array(z.string()),
  }),
  resumed: z.strictObject({
    from: z.enum(RUN_STATUSES),
    step: z.string().nullable(),
    base_commit: text,
    cap_usd_effective: z.number().finite().nullable(),
    processes: z.array(processEntry),
  }),
  killed: z.strictObject({
    processes: z.array(processEntry),
  }),
  preflight: z.strictObject({
    ok: z.boolean(),
    checks: z.array(z.string()),
    failed: z.strictObject({ code: text, where: text }).optional(),
  }),
  write_scope: z.strictObject({
    changes: z.array(
      z.strictObject({
        path: text,
        kind: z.enum(['added', 'modified', 'deleted']),
      }),
    ),
    restored: z.array(z.string()),
  }),
  usage: z.undefined(),
} as const;

export type KnownEventType = keyof typeof EVENT_PAYLOAD_SCHEMAS;
export type EventPayload<T extends KnownEventType> = z.infer<(typeof EVENT_PAYLOAD_SCHEMAS)[T]>;

export function isKnownEventType(type: string): type is KnownEventType {
  return Object.hasOwn(EVENT_PAYLOAD_SCHEMAS, type);
}

function payloadInvalid(type: string, detail: string): FactoryError {
  return new FactoryError({
    code: 'event_payload_invalid',
    message: `Cannot read event type ${type}: payload ${detail}.`,
    where: `events.${type}.payload`,
    next: `Fix the ${type} event payload in the event log, or write a new one that matches its schema.`,
    exitCode: 2,
  });
}

/**
 * Parses `row.payload_json` with the schema for `type`. A present value that is not JSON or does not
 * match throws `event_payload_invalid`. Callers that treat a missing payload as “no value” check for
 * a string first and skip this call.
 */
export function readPayload<T extends KnownEventType>(
  row: { payload_json?: unknown },
  type: T,
): EventPayload<T> {
  const raw = row.payload_json;
  let parsed: unknown;
  if (raw === null || raw === undefined) {
    parsed = undefined;
  } else if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw payloadInvalid(type, 'is not valid JSON');
    }
  } else {
    throw payloadInvalid(type, 'is not valid JSON');
  }

  const result = EVENT_PAYLOAD_SCHEMAS[type].safeParse(parsed);
  if (!result.success) {
    throw payloadInvalid(type, 'does not match its schema');
  }
  return result.data as EventPayload<T>;
}
