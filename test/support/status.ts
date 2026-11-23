import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { createStatusCommand } from '../../src/cli/status.js';
import {
  openEventLog,
  openEventLogReadOnly,
  type EventLog,
  type EventLogReadOnly,
  type RunInput,
} from '../../src/event-log/open.js';
import { createFakeProcessTable, type FakeProcessTable } from '../../src/ports/process-table.js';
import { createRunFolder } from '../../src/run-folder/create.js';
import { runCapture, type CliRun } from './cli-harness.js';
import { cleanupEventLogTest, eventLogSandbox, openRaw, runInput, track, type EventLogSandbox } from './event-log.js';
import { createFakeDeps, type FakeDeps } from './fake-deps.js';

/** The fake clock of every status test. */
export const NOW = Date.parse('2026-03-01T12:00:00.000Z');
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const iso = (ms: number): string => new Date(ms).toISOString();

export interface SeedStep {
  step: string;
  attempt?: number;
  status: 'pending' | 'running' | 'done' | 'failed';
}

export interface SeedRun {
  runId: string;
  ticket: string;
  repo?: string;
  flow?: string;
  status: string;
  /** How long before NOW the last event of the run happened. */
  lastEventAgoMs: number;
  /** How long before NOW the run started. Defaults to one hour before its last event. */
  startedAgoMs?: number;
  /** Cost events, all a second before the last event. */
  costs?: ReadonlyArray<{ usd: number; source: 'reported' | 'estimated' }>;
  /** Steps in the order they started. */
  steps?: readonly SeedStep[];
  /**
   * The un-ended process row of the run, as a fake process table sees it: `live` still matches, `gone` is not
   * in the table, `recycled` runs another command now. Absent means the run has no process row.
   */
  process?: 'live' | 'gone' | 'recycled';
}

export interface StatusFixture {
  sb: EventLogSandbox;
  deps: FakeDeps;
  processTable: FakeProcessTable;
  log: EventLog;
  reader: EventLogReadOnly;
  /** Inserts a run, its events, steps and process row, and creates its run folder with a file in it. */
  addRun: (seed: SeedRun) => void;
  /** Checkpoints the WAL and loosens the modes of the home and the db to values a writable open would change. */
  freeze: () => void;
  /** Everything a read-only command must leave as it found it: the files of the home and every table. */
  snapshot: () => Snapshot;
}

export interface Snapshot {
  tree: Record<string, string>;
  tables: Record<string, Array<Record<string, unknown>>>;
}

let nextPid = 5000;

let previousEnv: { home?: string; factoryHome?: string; path?: string } | undefined;

const rememberEnv = (): void => {
  previousEnv ??= { home: process.env.HOME, factoryHome: process.env.FACTORY_HOME, path: process.env.PATH };
};

/** Points HOME and FACTORY_HOME at the sandbox, for the in-process CLI. `cleanupStatusTest` restores them. */
export function pointEnvAt(sb: EventLogSandbox): void {
  rememberEnv();
  process.env.HOME = sb.tmp;
  process.env.FACTORY_HOME = sb.home;
}

/** The standard afterEach for status tests: restores the environment, closes every database, removes the temp homes. */
export function cleanupStatusTest(): void {
  if (previousEnv !== undefined) {
    const restore = (name: string, value: string | undefined): void => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('HOME', previousEnv.home);
    restore('FACTORY_HOME', previousEnv.factoryHome);
    restore('PATH', previousEnv.path);
    previousEnv = undefined;
  }
  cleanupEventLogTest();
}

/** Prepends `folder` to PATH for this test. `cleanupStatusTest` restores it. */
export function prependToPath(folder: string): void {
  rememberEnv();
  process.env.PATH = `${folder}:${process.env.PATH ?? ''}`;
}

/** Walks `root`: every entry with its kind, mode, size, mtime and content hash. `-shm` is a lock table, not data. */
export function snapshotTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (path: string): void => {
    const stat = lstatSync(path);
    const name = relative(root, path) || '.';
    const mode = (stat.mode & 0o777).toString(8);
    if (stat.isDirectory()) {
      out[name] = `dir mode=${mode} mtime=${stat.mtimeMs}`;
      for (const entry of readdirSync(path).sort()) {
        if (!entry.endsWith('-shm')) visit(join(path, entry));
      }
    } else {
      const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
      out[name] = `file mode=${mode} size=${stat.size} mtime=${stat.mtimeMs} sha256=${hash}`;
    }
  };
  if (existsSync(root)) visit(root);
  return out;
}

const TABLES = ['runs', 'steps', 'events', 'processes', 'approvals', 'outcomes'] as const;

/**
 * A temp HOME and FACTORY_HOME holding an event log (no config, no repos folder, no checkout), a fake clock
 * at NOW and a fake process table. Call `cleanupStatusTest` from afterEach.
 */
export function statusFixture(): StatusFixture {
  const sb = eventLogSandbox();
  pointEnvAt(sb);
  const deps = createFakeDeps({ start: NOW });
  const processTable = createFakeProcessTable();
  const log = track(openEventLog({ env: sb.env, deps }));
  const reader = track(openEventLogReadOnly({ env: sb.env }));

  const addRun = (seed: SeedRun): void => {
    const repo = seed.repo ?? 'example-frontend';
    const lastEvent = NOW - seed.lastEventAgoMs;
    const startedAt = NOW - (seed.startedAgoMs ?? seed.lastEventAgoMs + HOUR);
    log.insertRun(
      runInput({
        run_id: seed.runId,
        repo,
        ticket: seed.ticket,
        flow: seed.flow ?? 'A',
        status: seed.status as RunInput['status'],
        started_at: iso(startedAt),
      }),
    );
    for (const cost of seed.costs ?? []) {
      log.appendEvent({
        run_id: seed.runId,
        type: 'usage',
        started_at: iso(lastEvent - 1000),
        cost_usd: cost.usd,
        usage_source: cost.source,
      });
    }
    log.appendEvent({ run_id: seed.runId, type: 'run_status', started_at: iso(lastEvent), status: seed.status });
    (seed.steps ?? []).forEach((step, index) => {
      log.upsertStep({
        run_id: seed.runId,
        step: step.step,
        attempt: step.attempt ?? 1,
        status: step.status,
        started_at: iso(startedAt + (index + 1) * MINUTE),
      });
    });
    if (seed.process !== undefined) {
      const pid = nextPid++;
      const command = `agent --example-flag ${seed.runId}`;
      log.appendProcess({ run_id: seed.runId, step: 'implement', pid, command });
      if (seed.process !== 'gone') processTable.record({ pid, command, startedAt });
      if (seed.process === 'recycled') processTable.plantRecycledPid(pid, 'sleep 100');
    }
    createRunFolder({ env: sb.env, repo, ticket: seed.ticket });
  };

  const freeze = (): void => {
    openRaw(sb.dbPath).exec('PRAGMA wal_checkpoint(TRUNCATE)');
    // SQLite gives the WAL the mode of the db file, so the sidecars are loosened together with it.
    for (const path of [sb.dbPath, `${sb.dbPath}-wal`, `${sb.dbPath}-shm`]) {
      if (existsSync(path)) chmodSync(path, 0o640);
    }
    chmodSync(sb.home, 0o750);
  };

  const snapshot = (): Snapshot => ({
    tree: snapshotTree(sb.home),
    tables: Object.fromEntries(TABLES.map((table) => [table, reader.query(`SELECT * FROM ${table} ORDER BY rowid`)])),
  });

  return { sb, deps, processTable, log, reader, addRun, freeze, snapshot };
}

/** `factory status ...` from a folder that is not a git checkout, with the fixture's clock and process table. */
export function statusCli(fx: StatusFixture, args: string[]): Promise<CliRun> {
  return runCapture(['status', ...args], {
    cwd: fx.sb.tmp,
    commands: { status: createStatusCommand({ deps: fx.deps, processTable: fx.processTable }) },
  });
}

/**
 * The three runs of the main list case, inserted finished runs first:
 * - FE-123: building (flow B), step `implement` running after `prepare` done, no cost, live process, last event 5 min ago.
 * - FE-101: passed (flow A), reported cost $0.50 + $0.25, last event 2 h ago, started 3 days ago.
 * - FE-102: budget (flow C), reported $1 + estimated $0.50, last event 1 day ago, started after FE-101.
 */
export function seedThreeRuns(fx: StatusFixture): void {
  fx.addRun({
    runId: 'run-102',
    ticket: 'FE-102',
    flow: 'C',
    status: 'budget',
    lastEventAgoMs: DAY,
    startedAgoMs: DAY + HOUR,
    costs: [
      { usd: 1, source: 'reported' },
      { usd: 0.5, source: 'estimated' },
    ],
    steps: [{ step: 'implement', status: 'failed' }],
  });
  fx.addRun({
    runId: 'run-101',
    ticket: 'FE-101',
    flow: 'A',
    status: 'passed',
    lastEventAgoMs: 2 * HOUR,
    startedAgoMs: 3 * DAY,
    costs: [
      { usd: 0.5, source: 'reported' },
      { usd: 0.25, source: 'reported' },
    ],
    steps: [{ step: 'prepare', status: 'done' }],
  });
  fx.addRun({
    runId: 'run-123',
    ticket: 'FE-123',
    flow: 'B',
    status: 'building',
    lastEventAgoMs: 5 * MINUTE,
    steps: [
      { step: 'prepare', status: 'done' },
      { step: 'implement', status: 'running' },
    ],
    process: 'live',
  });
}

/** The lines of text output that mention `needle`. */
export const linesWith = (text: string, needle: string): string[] =>
  text.split('\n').filter((line) => line.includes(needle));
