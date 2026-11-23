import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { StatusDocumentSchema, type StatusRow } from '../../src/status/list-runs.js';
import { parseEnvelope, runCapture, type CliRun } from '../support/cli-harness.js';
import { eventLogSandbox, openRaw } from '../support/event-log.js';
import {
  cleanupStatusTest,
  DAY,
  HOUR,
  linesWith,
  MINUTE,
  pointEnvAt,
  prependToPath,
  seedThreeRuns,
  snapshotTree,
  statusCli,
  statusFixture,
} from '../support/status.js';
import { makeTempHome } from '../support/temp-home.js';

afterEach(() => {
  vi.restoreAllMocks();
  cleanupStatusTest();
});

/** The `data.rows` of a `--json` run, unparsed. */
const rowsOf = (run: CliRun): StatusRow[] => (parseEnvelope(run).data as { rows: StatusRow[] }).rows;

describe('factory status: active and recent runs', () => {
  test('given two finished runs and one running run, factory status lists all three with ticket, repo, flow, status, current step, cost marked reported or estimated, and time since the last event, with the active run first', async () => {
    const fx = statusFixture();
    seedThreeRuns(fx);

    const run = await statusCli(fx, []);

    expect(run.exitCode, run.stderr).toBe(0);
    const running = linesWith(run.stdout, 'FE-123');
    const passed = linesWith(run.stdout, 'FE-101');
    const budget = linesWith(run.stdout, 'FE-102');
    expect([running.length, passed.length, budget.length]).toEqual([1, 1, 1]);

    // The active run is first, then the finished runs, newest last event first.
    const lines = run.stdout.split('\n');
    const at = (ticket: string): number => lines.findIndex((line) => line.includes(ticket));
    expect(at('FE-123')).toBeLessThan(at('FE-101'));
    expect(at('FE-101')).toBeLessThan(at('FE-102'));

    // ticket, repo, flow, status, current step, no cost, 5 minutes since the last event.
    expect(running[0]).toContain('example-frontend');
    expect(running[0]).toMatch(/\bB\b/);
    expect(running[0]).toContain('building');
    expect(running[0]).toContain('implement');
    expect(running[0]).not.toMatch(/reported|estimated/);
    expect(running[0]).toMatch(/\b5 ?m(in)?\b/);
    expect(running[0]).not.toContain('stale');

    // A cost whose events were all reported, 2 hours since the last event.
    expect(passed[0]).toContain('example-frontend');
    expect(passed[0]).toMatch(/\bA\b/);
    expect(passed[0]).toContain('passed');
    expect(passed[0]).toContain('prepare');
    expect(passed[0]).toContain('0.75');
    expect(passed[0]).toContain('reported');
    expect(passed[0]).toMatch(/\b2 ?h\b/);

    // One estimated event makes the sum estimated, 1 day since the last event.
    expect(budget[0]).toContain('example-frontend');
    expect(budget[0]).toMatch(/\bC\b/);
    expect(budget[0]).toContain('budget');
    expect(budget[0]).toContain('implement');
    expect(budget[0]).toContain('1.5');
    expect(budget[0]).toContain('estimated');
    expect(budget[0]).toMatch(/\b1 ?d\b/);
  });
});

describe('factory status --json', () => {
  test('factory status --json prints one document with schema_version that parses against the status schema and holds the same rows in the same order as the text output', async () => {
    const fx = statusFixture();
    seedThreeRuns(fx);

    const json = await statusCli(fx, ['--json']);
    const text = await statusCli(fx, []);

    expect(json.exitCode, json.stderr).toBe(0);
    expect(text.exitCode, text.stderr).toBe(0);
    // stdout is exactly one JSON document.
    const envelope = parseEnvelope(json);
    expect(envelope).toMatchObject({ schema_version: 1, command: 'status', ok: true, exit_code: 0, errors: [] });
    const data = envelope.data as { schema_version: number };
    expect(data.schema_version).toBe(1);
    const document = StatusDocumentSchema.parse(data);
    expect(document.rows.map((row) => row.ticket)).toEqual(['FE-123', 'FE-101', 'FE-102']);
    expect(StatusDocumentSchema.safeParse({ ...data, schema_version: 2 }).success).toBe(false);

    // The text holds the same rows in the same order.
    const lines = text.stdout.split('\n');
    const positions = document.rows.map((row) => {
      const index = lines.findIndex((line) => line.includes(row.ticket));
      const line = lines[index] ?? '';
      expect(line, `text line of ${row.ticket}`).toContain(row.repo);
      expect(line).toContain(row.status);
      if (row.current_step !== null) expect(line).toContain(row.current_step);
      if (row.cost_source !== undefined) expect(line).toContain(row.cost_source);
      return index;
    });
    expect(positions.every((index) => index >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    // The JSON also carries the exact time of the last event and the elapsed milliseconds.
    expect(document.rows.map((row) => [row.last_event_at, row.elapsed_ms])).toEqual([
      ['2026-03-01T11:55:00.000Z', 5 * MINUTE],
      ['2026-03-01T10:00:00.000Z', 2 * HOUR],
      ['2026-02-28T12:00:00.000Z', DAY],
    ]);
  });
});

describe('factory status: a run whose process is gone', () => {
  test('a run still stored in a phase whose process is gone or no longer matches is listed as stale, the event log and run folders are unchanged, and the stored status is not rewritten to interrupted', async () => {
    const fx = statusFixture();
    fx.addRun({ runId: 'run-123', ticket: 'FE-123', status: 'building', lastEventAgoMs: 10 * MINUTE, process: 'recycled' });
    fx.addRun({ runId: 'run-124', ticket: 'FE-124', status: 'planning', lastEventAgoMs: 20 * MINUTE, process: 'gone' });
    fx.addRun({ runId: 'run-125', ticket: 'FE-125', status: 'gating', lastEventAgoMs: 30 * MINUTE, process: 'live' });
    fx.freeze();
    const before = fx.snapshot();
    const signal = vi.spyOn(process, 'kill');

    const json = await statusCli(fx, ['--json']);
    const text = await statusCli(fx, []);

    expect(json.exitCode, json.stderr).toBe(0);
    expect(text.exitCode, text.stderr).toBe(0);
    const rows = rowsOf(json);
    const byTicket = rows.map((row) => [row.ticket, row.status, row.stale] as const).sort((a, b) => a[0].localeCompare(b[0]));
    expect(byTicket).toEqual([
      ['FE-123', 'building', true],
      ['FE-124', 'planning', true],
      ['FE-125', 'gating', false],
    ]);
    expect(linesWith(text.stdout, 'FE-123')[0]).toContain('stale');
    expect(linesWith(text.stdout, 'FE-124')[0]).toContain('stale');
    expect(linesWith(text.stdout, 'FE-125')[0]).not.toContain('stale');

    // Nothing was written: files, modes, mtimes and every table are as they were.
    expect(fx.snapshot()).toEqual(before);
    expect(fx.reader.query('SELECT run_id, status FROM runs ORDER BY run_id')).toEqual([
      { run_id: 'run-123', status: 'building' },
      { run_id: 'run-124', status: 'planning' },
      { run_id: 'run-125', status: 'gating' },
    ]);
    expect(fx.reader.query("SELECT id FROM events WHERE status = 'interrupted'")).toEqual([]);
    // No pid was signalled.
    expect(signal).not.toHaveBeenCalled();
  });
});

describe('factory status FE-123', () => {
  test("factory status FE-123 lists only that ticket's runs", async () => {
    const fx = statusFixture();
    fx.addRun({ runId: 'run-a', ticket: 'FE-123', status: 'passed', lastEventAgoMs: 2 * HOUR });
    fx.addRun({ runId: 'run-b', ticket: 'FE-123', repo: 'example-other', status: 'passed', lastEventAgoMs: 3 * HOUR });
    fx.addRun({ runId: 'run-c', ticket: 'FE-123', status: 'building', lastEventAgoMs: 4 * HOUR, process: 'live' });
    fx.addRun({ runId: 'run-d', ticket: 'FE-124', status: 'building', lastEventAgoMs: MINUTE, process: 'live' });
    fx.addRun({ runId: 'run-e', ticket: 'FE-125', status: 'passed', lastEventAgoMs: MINUTE });

    const json = await statusCli(fx, ['FE-123', '--json']);
    const text = await statusCli(fx, ['FE-123']);

    expect(json.exitCode, json.stderr).toBe(0);
    expect(rowsOf(json).map((row) => row.run_id)).toEqual(['run-c', 'run-a', 'run-b']);
    expect(text.exitCode, text.stderr).toBe(0);
    expect(text.stdout).toContain('FE-123');
    expect(text.stdout).not.toContain('FE-124');
    expect(text.stdout).not.toContain('FE-125');
  });

  test('a ticket with no runs exits 0 with an empty list', async () => {
    const fx = statusFixture();
    seedThreeRuns(fx);

    const run = await statusCli(fx, ['FE-999', '--json']);

    expect(run.exitCode, run.stderr).toBe(0);
    expect(rowsOf(run)).toEqual([]);
  });
});

describe('factory status is read-only and needs no preflight, CLI or network', () => {
  test('factory status opens the event log read-only, runs no preflight, and starts no agent CLI', async () => {
    const fx = statusFixture();
    seedThreeRuns(fx);
    fx.addRun({ runId: 'run-124', ticket: 'FE-124', status: 'planning', lastEventAgoMs: MINUTE, process: 'gone' });
    // Stand-ins for every CLI the factory could start. Each one leaves a mark if it is ever run.
    const bin = join(makeTempHome(), 'bin');
    const marker = join(makeTempHome(), 'started.log');
    mkdirSync(bin);
    for (const name of ['agent', 'cursor-agent', 'opencode', 'copilot', 'acli', 'gh']) {
      writeFileSync(join(bin, name), `#!/bin/sh\necho ${name} >> "${marker}"\nexit 1\n`, { mode: 0o755 });
    }
    prependToPath(bin);
    const network = vi.spyOn(globalThis, 'fetch');
    // The home has no config and no repos folder, and the modes are looser than a writable open would leave them.
    fx.freeze();
    const before = fx.snapshot();

    const run = await statusCli(fx, ['--json']);

    expect(run.exitCode, run.stderr).toBe(0);
    expect(rowsOf(run)).toHaveLength(4);
    expect(existsSync(marker)).toBe(false);
    expect(network).not.toHaveBeenCalled();
    // A writable open would re-tighten the modes, add to the WAL or migrate; a preflight would add events.
    expect(fx.snapshot()).toEqual(before);
  });

  test('when factory.db is missing, status exits 0 with an empty list and creates no file', async () => {
    const sb = eventLogSandbox();
    pointEnvAt(sb);
    const before = readdirSync(sb.tmp);

    const json = await runCapture(['status', '--json'], { cwd: sb.tmp });
    const text = await runCapture(['status'], { cwd: sb.tmp });
    const one = await runCapture(['status', 'FE-123', '--json'], { cwd: sb.tmp });

    expect(json.exitCode, json.stderr).toBe(0);
    expect(parseEnvelope(json).data).toEqual({ schema_version: 1, rows: [] });
    expect(text.exitCode, text.stderr).toBe(0);
    expect(text.stdout.trim()).not.toBe('');
    expect(one.exitCode, one.stderr).toBe(0);
    expect(rowsOf(one)).toEqual([]);
    expect(existsSync(sb.home)).toBe(false);
    expect(existsSync(sb.dbPath)).toBe(false);
    expect(readdirSync(sb.tmp)).toEqual(before);
  });

  test('help and status skip the git version check', async () => {
    const sb = eventLogSandbox();
    pointEnvAt(sb);
    const runGitVersion = vi.fn(async (): Promise<string> => {
      throw new Error('git must not be started');
    });

    const help = await runCapture(['help'], { runGitVersion });
    const status = await runCapture(['status'], { runGitVersion, cwd: sb.tmp });

    expect(help.exitCode, help.stderr).toBe(0);
    expect(status.exitCode, status.stderr).toBe(0);
    expect(runGitVersion).not.toHaveBeenCalled();
  });

  /** A db with only a `meta` table holding `schema_version`, as the event-log tests write one. */
  async function refusedForSchema(version: number): Promise<void> {
    const sb = eventLogSandbox();
    pointEnvAt(sb);
    mkdirSync(sb.home, { recursive: true });
    const raw = openRaw(sb.dbPath);
    raw.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    raw.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(version));
    raw.close();
    const before = snapshotTree(sb.home);
    const bytes = readFileSync(sb.dbPath);

    const run = await runCapture(['status', '--json'], { cwd: sb.tmp });

    const envelope = parseEnvelope(run);
    expect(run.exitCode).toBe(4);
    expect(envelope.errors[0]?.code).toBe(version < 1 ? 'db_schema_older' : 'db_schema_newer');
    expect(envelope.errors[0]?.where).toBe(sb.dbPath);
    expect(envelope.errors[0]?.next).toBeTruthy();
    expect(snapshotTree(sb.home)).toEqual(before);
    expect(readFileSync(sb.dbPath).equals(bytes)).toBe(true);
  }

  test('a database with an older schema is refused as db_schema_older and nothing is written', () => refusedForSchema(0));

  test('a database with a newer schema is refused as db_schema_newer and nothing is written', () => refusedForSchema(2));
});

describe('factory status usage', () => {
  test('help lists status with an optional ticket', async () => {
    const help = await runCapture(['help']);

    expect(help.exitCode, help.stderr).toBe(0);
    expect(linesWith(help.stdout, 'status [ticket]')).toHaveLength(1);
  });

  test('a second ticket is refused with exit 2 and a message about the ticket, and a plain factory status still answers', async () => {
    const fx = statusFixture();
    seedThreeRuns(fx);

    const refused = await statusCli(fx, ['FE-123', 'FE-124', '--json']);
    const plain = await statusCli(fx, ['--json']);

    const envelope = parseEnvelope(refused);
    expect(refused.exitCode).toBe(2);
    expect(envelope.errors[0]?.code).toBe('invalid_usage');
    expect(envelope.errors[0]?.message.toLowerCase()).toContain('ticket');
    expect(envelope.errors[0]?.next).toBeTruthy();
    expect(plain.exitCode, plain.stderr).toBe(0);
  });

  test('an unknown flag is refused with exit 2 and names the flag, and a plain factory status still answers', async () => {
    const fx = statusFixture();
    seedThreeRuns(fx);

    const refused = await statusCli(fx, ['--frob', '--json']);
    const plain = await statusCli(fx, ['--json']);

    const envelope = parseEnvelope(refused);
    expect(refused.exitCode).toBe(2);
    expect(envelope.errors[0]?.code).toBe('unknown_flag');
    expect(envelope.errors[0]?.message).toContain('--frob');
    expect(plain.exitCode, plain.stderr).toBe(0);
  });

  test('a ticket that is not a slug is refused with exit 2 and a message about the ticket', async () => {
    const fx = statusFixture();
    seedThreeRuns(fx);

    const run = await statusCli(fx, ['../FE-123', '--json']);

    const envelope = parseEnvelope(run);
    expect(run.exitCode).toBe(2);
    expect(envelope.errors[0]?.code).toBe('ticket_invalid');
    expect(envelope.errors[0]?.message.toLowerCase()).toContain('ticket');
    expect(envelope.errors[0]?.next).toBeTruthy();
  });
});
