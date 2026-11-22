import { afterEach, describe, expect, test } from 'vitest';

import { openEventLog, type EventInput, type EventLog } from '../../src/event-log/open.js';
import { createFakeDeps, type FakeDeps } from '../support/fake-deps.js';
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

// 2026-01-02T03:04:05.000Z
const START_MS = Date.UTC(2026, 0, 2, 3, 4, 5);
const START_ISO = '2026-01-02T03:04:05.000Z';

interface Fixture {
  sb: EventLogSandbox;
  deps: FakeDeps;
  log: EventLog;
}

function setup(): Fixture {
  const sb = eventLogSandbox();
  const deps = createFakeDeps({ start: START_MS });
  const log = track(openEventLog({ env: sb.env, deps }));
  log.insertRun(runInput());
  return { sb, deps, log };
}

/** Event input that deliberately breaks the type, to prove validation does not rely on TypeScript. */
function untyped(input: Record<string, unknown>): EventInput {
  return input as unknown as EventInput;
}

function countRows(sb: EventLogSandbox, table: string): number {
  const raw = openRaw(sb.dbPath, { readOnly: true });
  return Number(raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n);
}

describe('event ids', () => {
  test('two appended events get ids 1 then 2', () => {
    const { sb, log } = setup();

    const first = log.appendEvent({ run_id: 'run-1', type: 'run_started' });
    const second = log.appendEvent({ run_id: 'run-1', type: 'step_started' });

    expect([first.id, second.id]).toEqual([1, 2]);
    const raw = openRaw(sb.dbPath, { readOnly: true });
    expect(raw.prepare('SELECT id FROM events ORDER BY id').all()).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test('event ids keep increasing after the log is closed and opened again', () => {
    const { sb, deps, log } = setup();
    log.appendEvent({ run_id: 'run-1', type: 'run_started' });
    log.appendEvent({ run_id: 'run-1', type: 'step_started' });
    log.close();

    const reopened = track(openEventLog({ env: sb.env, deps }));
    const third = reopened.appendEvent({ run_id: 'run-1', type: 'step_finished' });

    expect(third.id).toBe(3);
  });
});

describe('append-only tables', () => {
  test('appendEvent has no update or delete method', () => {
    const { log } = setup();

    expect(typeof log.appendEvent).toBe('function');
    expect(Object.keys(log).filter((name) => /^(update|delete|remove)Event/.test(name))).toEqual([]);
    expect('updateEvent' in log).toBe(false);
    expect('deleteEvent' in log).toBe(false);
  });

  test('a raw SQL UPDATE on events is refused', () => {
    const { sb, log } = setup();
    log.appendEvent({ run_id: 'run-1', type: 'run_started' });
    const raw = openRaw(sb.dbPath);

    expect(() => raw.exec("UPDATE events SET type = 'rewritten'")).toThrow();

    expect(raw.prepare('SELECT type FROM events').all()).toEqual([{ type: 'run_started' }]);
  });

  test('a raw SQL DELETE on events is refused', () => {
    const { sb, log } = setup();
    log.appendEvent({ run_id: 'run-1', type: 'run_started' });
    const raw = openRaw(sb.dbPath);

    expect(() => raw.exec('DELETE FROM events')).toThrow();

    expect(countRows(sb, 'events')).toBe(1);
  });

  test('the same update and delete refusal applies to check_rows, approvals, outcomes and shadow_verdicts', () => {
    const { sb, log } = setup();
    const event = log.appendEvent({ run_id: 'run-1', type: 'gate_finished' });
    log.appendCheckRows(event.id, [{ gate: 'lint', item: 'src/index.ts', ok: true }]);
    log.appendApproval({ run_id: 'run-1', plan_hash: 'a'.repeat(64), approver: 'example-approver', client: 'cli' });
    log.appendOutcome({ run_id: 'run-1', outcome: 'accepted' });
    log.appendShadowVerdict({ run_id: 'run-1', plan_hash: 'a'.repeat(64), would_approve: true, rows: [] });
    const raw = openRaw(sb.dbPath);

    for (const table of ['check_rows', 'approvals', 'outcomes', 'shadow_verdicts']) {
      // SET id = id names a column every one of these tables has, and still fires the trigger.
      expect(() => raw.exec(`UPDATE ${table} SET id = id`), `UPDATE ${table}`).toThrow();
      expect(() => raw.exec(`DELETE FROM ${table}`), `DELETE ${table}`).toThrow();
      expect(countRows(sb, table), `rows in ${table}`).toBe(1);
    }
  });
});

describe('mutable rows', () => {
  test('upsertStep can change a step status', () => {
    const { sb, log } = setup();

    log.upsertStep({ run_id: 'run-1', step: 'plan', status: 'running' });
    log.upsertStep({ run_id: 'run-1', step: 'plan', status: 'done' });

    const raw = openRaw(sb.dbPath, { readOnly: true });
    expect(raw.prepare('SELECT step, attempt, status FROM steps').all()).toEqual([
      { step: 'plan', attempt: 1, status: 'done' },
    ]);
  });

  test('upsertStep stores optional role, model and checkpoint columns', () => {
    const { sb, log } = setup();

    log.upsertStep({
      run_id: 'run-1',
      step: 'plan',
      attempt: 1,
      role: 'planner',
      model: 'example-model-high',
      purpose: 'write the plan',
      status: 'done',
      exit_reason: 'ok',
      input_hash: 'abc',
      cli_session_id: 'ses_example',
    });

    const raw = openRaw(sb.dbPath, { readOnly: true });
    expect(
      raw
        .prepare('SELECT role, model, purpose, exit_reason, input_hash, cli_session_id FROM steps')
        .get(),
    ).toEqual({
      role: 'planner',
      model: 'example-model-high',
      purpose: 'write the plan',
      exit_reason: 'ok',
      input_hash: 'abc',
      cli_session_id: 'ses_example',
    });
  });

  test('updateRunStatus can change a run status', () => {
    const { sb, log } = setup();

    log.updateRunStatus('run-1', 'building');

    const raw = openRaw(sb.dbPath, { readOnly: true });
    expect(raw.prepare('SELECT status FROM runs WHERE run_id = ?').get('run-1')).toEqual({ status: 'building' });
  });

  test('endProcess can set ended_at', () => {
    const { sb, deps, log } = setup();
    const started = log.appendProcess({ run_id: 'run-1', step: 'gate', pid: 4242, command: 'npm test' });
    deps.advance(1000);

    log.endProcess(started.id);

    const raw = openRaw(sb.dbPath, { readOnly: true });
    expect(raw.prepare('SELECT started_at, ended_at FROM processes WHERE id = ?').get(started.id)).toEqual({
      started_at: START_ISO,
      ended_at: '2026-01-02T03:04:06.000Z',
    });
  });
});

describe('events with a missing required field', () => {
  test('appendEvent without run_id is refused as event_invalid and writes no row', () => {
    const { sb, log } = setup();

    const error = errorFields(thrownBy(() => log.appendEvent(untyped({ type: 'run_started', started_at: START_ISO }))));

    expect(error.code).toBe('event_invalid');
    expect(countRows(sb, 'events')).toBe(0);
  });

  test('appendEvent without type is refused', () => {
    const { sb, log } = setup();

    const error = errorFields(thrownBy(() => log.appendEvent(untyped({ run_id: 'run-1', started_at: START_ISO }))));

    expect(error.code).toBe('event_invalid');
    expect(countRows(sb, 'events')).toBe(0);
  });

  test('appendEvent without started_at and with no clock fill is refused', () => {
    const { sb, log } = setup();

    // The log fills a missing started_at from the clock, so the refusal is for explicit bad values.
    const empty = errorFields(thrownBy(() => log.appendEvent({ run_id: 'run-1', type: 'run_started', started_at: '' })));
    const notIso = errorFields(
      thrownBy(() => log.appendEvent({ run_id: 'run-1', type: 'run_started', started_at: 'yesterday' })),
    );

    expect([empty.code, notIso.code]).toEqual(['event_invalid', 'event_invalid']);
    expect(countRows(sb, 'events')).toBe(0);
  });

  test('appendEvent with an empty type is refused', () => {
    const { sb, log } = setup();

    const error = errorFields(thrownBy(() => log.appendEvent({ run_id: 'run-1', type: '' })));

    expect(error.code).toBe('event_invalid');
    expect(countRows(sb, 'events')).toBe(0);
  });

  test('appendEvent for a run that does not exist is refused as event_invalid and writes no row', () => {
    const { sb, log } = setup();

    const error = errorFields(thrownBy(() => log.appendEvent({ run_id: 'run-missing', type: 'run_started' })));

    expect(error.code).toBe('event_invalid');
    expect(error.where).toBe('events.run_id');
    expect(countRows(sb, 'events')).toBe(0);
  });

  test('appendEvent with a field that is not a column is refused', () => {
    const { sb, log } = setup();

    const error = errorFields(thrownBy(() => log.appendEvent(untyped({ run_id: 'run-1', type: 'x', message: 'text' }))));

    expect(error.code).toBe('event_invalid');
    expect(error.where).toBe('events.message');
    expect(countRows(sb, 'events')).toBe(0);
  });

  test('the refusal names the field and a next action, exit code 2', () => {
    const { log } = setup();

    const missingRunId = errorFields(thrownBy(() => log.appendEvent(untyped({ type: 'run_started' }))));
    const emptyType = errorFields(thrownBy(() => log.appendEvent({ run_id: 'run-1', type: '' })));

    expect(missingRunId.exitCode).toBe(2);
    expect(`${missingRunId.message} ${missingRunId.where}`).toContain('run_id');
    expect(missingRunId.next).toBeTruthy();
    expect(emptyType.exitCode).toBe(2);
    expect(`${emptyType.message} ${emptyType.where}`).toContain('type');
    expect(emptyType.next).toBeTruthy();
  });
});

describe('check rows', () => {
  test('rows are written with the event id, and one bad row writes none', () => {
    const { sb, log } = setup();
    const event = log.appendEvent({ run_id: 'run-1', type: 'gate_finished' });

    log.appendCheckRows(event.id, [
      { gate: 'lint', item: 'src/a.ts', ok: true },
      { gate: 'lint', item: 'src/b.ts', ok: false, note: 'unused variable' },
    ]);
    const error = errorFields(
      thrownBy(() =>
        log.appendCheckRows(event.id, [
          { gate: 'test', item: 'a', ok: true },
          { gate: '', item: 'b', ok: true },
        ]),
      ),
    );

    expect(error.code).toBe('row_invalid');
    const raw = openRaw(sb.dbPath, { readOnly: true });
    expect(raw.prepare('SELECT event_id, gate, item, ok, note FROM check_rows ORDER BY id').all()).toEqual([
      { event_id: 1, gate: 'lint', item: 'src/a.ts', ok: 1, note: null },
      { event_id: 1, gate: 'lint', item: 'src/b.ts', ok: 0, note: 'unused variable' },
    ]);
  });
});

describe('well-formed events', () => {
  test('a well-formed event for an existing run is written', () => {
    const { sb, log } = setup();

    const written = log.appendEvent({
      run_id: 'run-1',
      type: 'run_started',
      started_at: START_ISO,
      step: 'preflight',
      payload: { ticket: 'FE-123', message: 'run started' },
    });

    expect(written.id).toBe(1);
    const raw = openRaw(sb.dbPath, { readOnly: true });
    expect(raw.prepare('SELECT run_id, type, started_at, step, payload_json FROM events').all()).toEqual([
      {
        run_id: 'run-1',
        type: 'run_started',
        started_at: START_ISO,
        step: 'preflight',
        payload_json: '{"ticket":"FE-123","message":"run started"}',
      },
    ]);
  });

  test('an event without started_at gets the clock time as ISO text', () => {
    const { sb, log } = setup();

    log.appendEvent({ run_id: 'run-1', type: 'run_started' });

    const raw = openRaw(sb.dbPath, { readOnly: true });
    expect(raw.prepare('SELECT started_at FROM events').all()).toEqual([{ started_at: START_ISO }]);
  });

  test('an event stores optional role, model and usage columns', () => {
    const { sb, log } = setup();

    log.appendEvent({
      run_id: 'run-1',
      type: 'step_finished',
      step: 'plan',
      attempt: 1,
      role: 'planner',
      model: 'example-model-high',
      purpose: 'write the plan',
      ended_at: START_ISO,
      status: 'ok',
      input_tokens: 10,
      output_tokens: 4,
      cache_read_tokens: 2,
      cache_write_tokens: 1,
      reasoning_tokens: 0,
      cost_usd: 0.01,
      usage_source: 'estimated',
      context_used: 100,
      context_window: 200,
    });

    const raw = openRaw(sb.dbPath, { readOnly: true });
    expect(
      raw
        .prepare(
          `SELECT step, attempt, role, model, purpose, ended_at, status,
                  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
                  cost_usd, usage_source, context_used, context_window
           FROM events`,
        )
        .get(),
    ).toEqual({
      step: 'plan',
      attempt: 1,
      role: 'planner',
      model: 'example-model-high',
      purpose: 'write the plan',
      ended_at: START_ISO,
      status: 'ok',
      input_tokens: 10,
      output_tokens: 4,
      cache_read_tokens: 2,
      cache_write_tokens: 1,
      reasoning_tokens: 0,
      cost_usd: 0.01,
      usage_source: 'estimated',
      context_used: 100,
      context_window: 200,
    });
  });
});
