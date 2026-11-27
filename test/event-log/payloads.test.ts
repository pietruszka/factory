import { afterEach, describe, expect, test } from 'vitest';

import { openEventLog, type EventInput, type EventLog } from '../../src/event-log/open.js';
import { readPayload } from '../../src/event-log/payloads.js';
import { FactoryError } from '../../src/platform/errors.js';
import { createFakeDeps } from '../support/fake-deps.js';
import {
  cleanupEventLogTest,
  errorFields,
  eventLogSandbox,
  openRaw,
  runInput,
  thrownBy,
  track,
  type EventLogSandbox,
} from '../support/event-log.js';

afterEach(cleanupEventLogTest);

const START_MS = Date.UTC(2026, 0, 2, 3, 4, 5);

interface Fixture {
  sb: EventLogSandbox;
  log: EventLog;
}

function setup(): Fixture {
  const sb = eventLogSandbox();
  const log = track(openEventLog({ env: sb.env, deps: createFakeDeps({ start: START_MS }) }));
  log.insertRun(runInput());
  return { sb, log };
}

function untyped(input: Record<string, unknown>): EventInput {
  return input as unknown as EventInput;
}

function payloadRow(sb: EventLogSandbox, type: string): { payload_json: unknown } {
  const row = openRaw(sb.dbPath, { readOnly: true })
    .prepare('SELECT payload_json FROM events WHERE type = ? ORDER BY id DESC LIMIT 1')
    .get(type);
  expect(row).toBeDefined();
  return { payload_json: row!.payload_json };
}

describe('known event payloads round-trip', () => {
  test('worktree_created, run_status, run_stop and draft_pr read back as written', () => {
    const { sb, log } = setup();
    const worktree = {
      path: '/tmp/wt',
      base_commit: 'abc123',
      mode: 'linked' as const,
      allowed_paths: ['src/**'],
    };
    const status = { from: 'planning' as const, to: 'awaiting_approval' as const };
    const stop = { next: 'Raise the cap and resume.', spentUsd: 1.5, elapsedMs: 1000 };
    const draft = { number: 42 };

    log.appendEvent({ run_id: 'run-1', type: 'worktree_created', payload: worktree });
    log.appendEvent({ run_id: 'run-1', type: 'run_status', status: 'awaiting_approval', payload: status });
    log.appendEvent({ run_id: 'run-1', type: 'run_stop', status: 'budget', payload: stop });
    log.appendEvent({ run_id: 'run-1', type: 'draft_pr', payload: draft });

    expect(readPayload(payloadRow(sb, 'worktree_created'), 'worktree_created')).toEqual(worktree);
    expect(readPayload(payloadRow(sb, 'run_status'), 'run_status')).toEqual(status);
    expect(readPayload(payloadRow(sb, 'run_stop'), 'run_stop')).toEqual(stop);
    expect(readPayload(payloadRow(sb, 'draft_pr'), 'draft_pr')).toEqual(draft);
  });
});

describe('readPayload refuses a bad payload', () => {
  test('bad JSON throws event_payload_invalid, not SyntaxError', () => {
    const error = thrownBy(() => readPayload({ payload_json: '{not-json' }, 'run_stop'));
    expect(error).toBeInstanceOf(FactoryError);
    expect(error).not.toBeInstanceOf(SyntaxError);
    const fields = errorFields(error);
    expect(fields.code).toBe('event_payload_invalid');
    expect(fields.where).toBe('events.run_stop.payload');
  });

  test('a wrong shape throws event_payload_invalid naming the type', () => {
    const error = thrownBy(() => readPayload({ payload_json: '{"number":0}' }, 'draft_pr'));
    expect(error).toBeInstanceOf(FactoryError);
    expect(error).not.toBeInstanceOf(TypeError);
    const fields = errorFields(error);
    expect(fields.code).toBe('event_payload_invalid');
    expect(fields.where).toContain('draft_pr');
  });
});

describe('appendEvent refuses a known-type payload mismatch', () => {
  test('a bad worktree_created payload is event_invalid and writes no row', () => {
    const { sb, log } = setup();

    const error = errorFields(
      thrownBy(() => log.appendEvent(untyped({ run_id: 'run-1', type: 'worktree_created', payload: { path: '/tmp' } }))),
    );

    expect(error.code).toBe('event_invalid');
    expect(error.where).toMatch(/^events\./);
    const raw = openRaw(sb.dbPath, { readOnly: true });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 0 });
  });

  test('an unknown type still accepts a free-form payload', () => {
    const { sb, log } = setup();

    log.appendEvent({ run_id: 'run-1', type: 'tool_called', payload: { detail: 'anything goes' } });

    const raw = openRaw(sb.dbPath, { readOnly: true });
    expect(raw.prepare('SELECT type, payload_json FROM events').all()).toEqual([
      { type: 'tool_called', payload_json: '{"detail":"anything goes"}' },
    ]);
  });
});
