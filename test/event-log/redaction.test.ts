import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';

import { openEventLog, type EventLog } from '../../src/event-log/open.js';
import { createFakeDeps } from '../support/fake-deps.js';
import {
  cleanupEventLogTest,
  eventLogSandbox,
  openRaw,
  runInput,
  track,
  type EventLogSandbox,
} from '../support/event-log.js';

afterEach(cleanupEventLogTest);

// Obviously fake fixture secrets.
const FAKE_GITHUB_TOKEN = 'ghp_EXAMPLE_NOT_A_REAL_TOKEN';
const FAKE_ENV_SECRET = 'example-secret-value-123456';
const FAKE_PEM = '-----BEGIN PRIVATE KEY-----\nEXAMPLENOTAREALKEYMATERIAL\n-----END PRIVATE KEY-----';

function setup(extraEnv: NodeJS.ProcessEnv = {}): { sb: EventLogSandbox; log: EventLog } {
  const sb = eventLogSandbox(extraEnv);
  const log = track(openEventLog({ env: sb.env, deps: createFakeDeps() }));
  log.insertRun(runInput());
  return { sb, log };
}

function payloadJsonOf(sb: EventLogSandbox): string {
  const raw = openRaw(sb.dbPath, { readOnly: true });
  return String(raw.prepare('SELECT payload_json FROM events').get()?.payload_json);
}

/** Every row of every table as one string, to look for a leaked value anywhere. */
function dumpAllTables(sb: EventLogSandbox): string {
  const raw = openRaw(sb.dbPath, { readOnly: true });
  const tables = raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => String(row.name));
  return tables.map((table) => JSON.stringify(raw.prepare(`SELECT * FROM ${table}`).all())).join('\n');
}

describe('payload redaction', () => {
  test('an environment value in a name matching TOKEN is replaced with [REDACTED] in payload_json', () => {
    const { sb, log } = setup({ EXAMPLE_API_TOKEN: FAKE_ENV_SECRET });

    log.appendEvent({ run_id: 'run-1', type: 'tool_called', payload: { detail: `calling with ${FAKE_ENV_SECRET} now` } });

    expect(payloadJsonOf(sb)).toBe('{"detail":"calling with [REDACTED] now"}');
  });

  test('a string starting with ghp_ in the payload is replaced even when it is not in the environment', () => {
    const { sb, log } = setup();

    log.appendEvent({ run_id: 'run-1', type: 'tool_called', payload: { header: `token ${FAKE_GITHUB_TOKEN}` } });

    const stored = payloadJsonOf(sb);
    expect(stored).not.toContain(FAKE_GITHUB_TOKEN);
    expect(stored).toContain('[REDACTED]');
  });

  test('a PEM private-key header in the payload is replaced', () => {
    const { sb, log } = setup();

    log.appendEvent({ run_id: 'run-1', type: 'tool_called', payload: { key: FAKE_PEM } });

    const stored = payloadJsonOf(sb);
    expect(stored).not.toContain('BEGIN PRIVATE KEY');
    expect(stored).not.toContain('EXAMPLENOTAREALKEYMATERIAL');
    expect(stored).toContain('[REDACTED]');
  });

  test('a value passed as an extra secret is replaced', () => {
    const sb = eventLogSandbox();
    const log = track(openEventLog({ env: sb.env, deps: createFakeDeps(), extraSecrets: ['extra-secret-value-7890'] }));
    log.insertRun(runInput());

    log.appendEvent({ run_id: 'run-1', type: 'tool_called', payload: { note: 'uses extra-secret-value-7890' } });

    expect(payloadJsonOf(sb)).toBe('{"note":"uses [REDACTED]"}');
  });

  test('a value shorter than 6 characters is not used as an exact-value secret', () => {
    const { sb, log } = setup({ EXAMPLE_PASS: 'abc12' });

    log.appendEvent({ run_id: 'run-1', type: 'tool_called', payload: { note: 'the code abc12 stays' } });

    expect(payloadJsonOf(sb)).toBe('{"note":"the code abc12 stays"}');
  });
});

describe('redaction before the write', () => {
  test('the raw secret does not appear in payload_json or in other written text columns', () => {
    const { sb, log } = setup({ EXAMPLE_API_TOKEN: FAKE_ENV_SECRET });
    const event = log.appendEvent({
      run_id: 'run-1',
      type: `type ${FAKE_ENV_SECRET}`,
      step: `step ${FAKE_GITHUB_TOKEN}`,
      payload: { a: [FAKE_ENV_SECRET, { b: FAKE_GITHUB_TOKEN }], message: `message ${FAKE_ENV_SECRET}` },
    });
    log.appendCheckRows(event.id, [{ gate: 'lint', item: `item ${FAKE_GITHUB_TOKEN}`, ok: false, note: `note ${FAKE_ENV_SECRET}` }]);
    log.appendProcess({ run_id: 'run-1', step: `step ${FAKE_ENV_SECRET}`, pid: 4242, command: `curl -H "Authorization: ${FAKE_GITHUB_TOKEN}"` });
    log.appendApproval({
      run_id: 'run-1',
      plan_hash: 'a'.repeat(64),
      approver: `approver ${FAKE_ENV_SECRET}`,
      client: `client ${FAKE_GITHUB_TOKEN}`,
    });
    log.appendShadowVerdict({
      run_id: 'run-1',
      plan_hash: 'a'.repeat(64),
      would_approve: false,
      rows: [{ reason: `reason ${FAKE_GITHUB_TOKEN}` }],
    });
    log.appendOutcome({
      run_id: 'run-1',
      outcome: 'rejected',
      reason: `reason ${FAKE_ENV_SECRET}`,
      note: `note ${FAKE_GITHUB_TOKEN}`,
    });

    const dump = dumpAllTables(sb);

    expect(dump).not.toContain(FAKE_ENV_SECRET);
    expect(dump).not.toContain(FAKE_GITHUB_TOKEN);
    expect(dump).toContain('[REDACTED]');
  });

  test('redaction runs before the insert: a row read back is already redacted', () => {
    const { sb, log } = setup({ EXAMPLE_API_TOKEN: FAKE_ENV_SECRET });

    log.appendEvent({ run_id: 'run-1', type: 'tool_called', payload: { a: FAKE_ENV_SECRET, b: FAKE_GITHUB_TOKEN } });

    // Read through a second connection while the writer is still open, and read the raw files too:
    // a secret written first and scrubbed later would still sit in the database or WAL bytes.
    expect(payloadJsonOf(sb)).toBe('{"a":"[REDACTED]","b":"[REDACTED]"}');
    for (const file of [sb.dbPath, `${sb.dbPath}-wal`]) {
      if (existsSync(file)) {
        const bytes = readFileSync(file).toString('latin1');
        expect(bytes, file).not.toContain(FAKE_ENV_SECRET);
        expect(bytes, file).not.toContain(FAKE_GITHUB_TOKEN);
      }
    }
    expect(existsSync(sb.dbPath)).toBe(true);
  });

  test('fixture tokens are obviously fake', () => {
    const { sb, log } = setup();

    for (const fixture of [FAKE_GITHUB_TOKEN, FAKE_ENV_SECRET, FAKE_PEM]) {
      expect(fixture).toMatch(/EXAMPLE|example/);
    }
    log.appendEvent({ run_id: 'run-1', type: 'tool_called', payload: { token: FAKE_GITHUB_TOKEN } });

    expect(payloadJsonOf(sb)).toBe('{"token":"[REDACTED]"}');
  });
});
