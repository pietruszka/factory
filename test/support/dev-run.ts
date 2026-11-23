import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { expect } from 'vitest';

import { openEventLog, openEventLogReadOnly, type EventLog, type EventLogReadOnly } from '../../src/event-log/open.js';
import { createMacosProcessTable } from '../../src/ports/process-table.js';
import { createMacosSpawner } from '../../src/ports/spawner.js';
import type { RunStateContext, RunStatus } from '../../src/run-state/context.js';
import { runStubBuild, runStubPlan } from '../../src/run-state/stub-pipeline.js';
import { createWorktree } from '../../src/worktree/create.js';
import type { WorkerRuntime } from '../../src/worker-runtime/types.js';
import { runCapture, type CliRun } from './cli-harness.js';
import { runInput, track } from './event-log.js';
import { createFakeDeps } from './fake-deps.js';
import { createFakeWorkerRuntime, loadScenario } from './fake-worker.js';
import { cleanupRunStateTest, instrument } from './run-state.js';
import { envFor, markedHome } from './todo-sandbox.js';
import { makeTempHome } from './temp-home.js';
import { git, makeWorkRepo } from './work-repo.js';

const SCENARIOS = join(import.meta.dirname, '..', 'fixtures', 'worker-scenarios');
const START_TIME = Date.parse('2026-01-01T10:00:00.000Z');
const MARKER = '.factory-dev-home';

/**
 * Where the factory home of the run lives:
 * - `throwaway`: a marked home under the temp HOME, `FACTORY_HOME` set to it.
 * - `unmarked`: the same, with the dev-home marker removed once the run is set up.
 * - `default`: a marked home at `<HOME>/.factory` (the default location), `FACTORY_HOME` set to it.
 * - `unset`: the same default home, with `FACTORY_HOME` not set when the CLI runs.
 * Every one of them is inside a fresh temp HOME.
 */
export type HomeKind = 'throwaway' | 'unmarked' | 'default' | 'unset';

/** `sandbox`: the run's repo is at `<cache>/sandbox/todo-app`. `elsewhere`: a disposable repo outside the cache. */
export type RepoKind = 'sandbox' | 'elsewhere';

export interface DevRunOptions {
  home?: HomeKind;
  repo?: RepoKind;
}

export interface DevRun {
  tmp: string;
  factoryHome: string;
  /** The checkout the CLI runs from; the repo of run-1. */
  repoPath: string;
  repoName: string;
  runFolder: string;
  worktree: string;
  context: RunStateContext;
  reader: EventLogReadOnly;
  log: EventLog;
  /** Rows of the event log for run-1, as plain objects. */
  rows: (sql: string, ...params: Array<string | number | null>) => Array<Record<string, unknown>>;
  status: () => string;
  /** Preflight to `awaiting_approval` with the stub plan step and a fake worker. */
  plan: () => Promise<RunStatus>;
  /** The stub build steps with a fake worker playing `edits`, to a final status. */
  build: () => Promise<RunStatus>;
  /** Records a process row whose command is not the fake worker's, as a run with a real worker would leave. */
  recordOtherWorker: () => void;
  /** Runs `factory dev-approve ... --json` from `repoPath` with the process environment pointing at this home. */
  devApprove: (args?: string[]) => Promise<CliRun>;
  /** Every approvals row, plain objects, oldest first. */
  approvals: () => Array<Record<string, unknown>>;
  /** Count of event rows of run-1 (any type). */
  eventCount: () => number;
}

let previousEnv: { HOME?: string; FACTORY_HOME?: string } | undefined;

function setProcessEnv(tmp: string, factoryHome: string | undefined): void {
  previousEnv ??= { HOME: process.env.HOME, FACTORY_HOME: process.env.FACTORY_HOME };
  process.env.HOME = tmp;
  if (factoryHome === undefined) {
    delete process.env.FACTORY_HOME;
  } else {
    process.env.FACTORY_HOME = factoryHome;
  }
}

/** The standard afterEach for dev-run tests: restores HOME and FACTORY_HOME, then the run-state cleanup. */
export async function cleanupDevRunTest(): Promise<void> {
  if (previousEnv !== undefined) {
    for (const key of ['HOME', 'FACTORY_HOME'] as const) {
      const value = previousEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    previousEnv = undefined;
  }
  await cleanupRunStateTest();
}

function writeRepoConfig(factoryHome: string, repoName: string, repoPath: string): void {
  mkdirSync(join(factoryHome, 'repos'), { recursive: true });
  writeFileSync(
    join(factoryHome, 'repos', `${repoName}.yaml`),
    stringify({
      match: { path: repoPath },
      base_branch: 'main',
      package_manager: 'npm',
      install: 'npm ci',
      gates: { lint: 'npm run lint', typecheck: 'npm run typecheck', test: 'npm test' },
    }),
  );
}

/**
 * A temp HOME with a factory home of the given kind and run `run-1` for `FE-123` in `preflight`. A sandbox run
 * in a throwaway home uses the real unpacked to-do sample (through `factory dev-init --sample`); the other
 * layouts use a disposable repo at the same place. The fake worker is the only worker. No model CLI starts.
 * Call `cleanupDevRunTest` from afterEach.
 */
export async function devRunFixture(options: DevRunOptions = {}): Promise<DevRun> {
  const { home: homeKind = 'throwaway', repo: repoKind = 'sandbox' } = options;
  const tmp = makeTempHome();
  const atDefault = homeKind === 'default' || homeKind === 'unset';
  const factoryHome = atDefault ? markedHome(tmp, '.factory') : markedHome(tmp, 'factory-dev-home');
  const configured = homeKind === 'unset' ? undefined : factoryHome;
  const cacheRoot = homeKind === 'unset' ? join(tmp, '.cache', 'factory') : join(factoryHome, 'cache');
  const env = envFor(tmp, configured);
  writeFileSync(join(factoryHome, 'config.yaml'), 'version: 1\n');

  let repoName: string;
  let repoPath: string;
  if (repoKind === 'sandbox') {
    repoName = 'todo-app';
    repoPath = join(cacheRoot, 'sandbox', 'todo-app');
    if (homeKind === 'throwaway' || homeKind === 'unmarked') {
      setProcessEnv(tmp, configured);
      const unpacked = await runCapture(['dev-init', '--sample', 'todo-v0', '--json']);
      expect(unpacked.exitCode, unpacked.stderr).toBe(0);
    } else {
      makeWorkRepo(repoPath);
      writeRepoConfig(factoryHome, repoName, repoPath);
    }
  } else {
    repoName = 'example-frontend';
    repoPath = join(tmp, 'work', 'example-frontend');
    makeWorkRepo(repoPath);
    writeRepoConfig(factoryHome, repoName, repoPath);
  }
  const baseCommit = git(repoPath, 'rev-parse', 'HEAD');

  const deps = createFakeDeps({ start: START_TIME });
  const log = track(openEventLog({ env, deps }));
  const reader = track(openEventLogReadOnly({ env }));
  log.insertRun(runInput({ repo: repoName, ticket: 'FE-123', base_commit: baseCommit }));
  const context: RunStateContext = { env, deps, log, reader };
  const worktree = join(cacheRoot, 'worktrees', repoName, 'FE-123');
  const runFolder = join(factoryHome, 'runs', repoName, 'FE-123');

  const processTable = createMacosProcessTable();
  const spawner = createMacosSpawner({ processTable, deps });
  const runtime = (scenario: string): WorkerRuntime =>
    instrument(
      createFakeWorkerRuntime({
        scenario: loadScenario(join(SCENARIOS, `${scenario}.json`)),
        spawner,
        processTable,
        deps,
        eventLog: log,
      }),
    ).runtime;
  const rows: DevRun['rows'] = (sql, ...params) => reader.query(sql, ...params);

  if (homeKind === 'unmarked') {
    rmSync(join(factoryHome, MARKER));
  }
  setProcessEnv(tmp, configured);

  return {
    tmp,
    factoryHome,
    repoPath,
    repoName,
    runFolder,
    worktree,
    context,
    reader,
    log,
    rows,
    status: () => String(rows("SELECT status FROM runs WHERE run_id = 'run-1'")[0]?.status),
    plan: async () => {
      createWorktree({
        env,
        deps,
        log,
        reader,
        runId: 'run-1',
        repo: repoName,
        ticket: 'FE-123',
        repoPath,
        baseCommit,
      });
      return runStubPlan({ ...context, runtime: runtime('final-json'), runId: 'run-1', worktree });
    },
    build: () => runStubBuild({ ...context, runtime: runtime('edits'), runId: 'run-1', worktree }),
    recordOtherWorker: () => {
      log.appendProcess({ run_id: 'run-1', step: 'plan', pid: 4242, command: 'cursor-agent --print --output-format json' });
    },
    devApprove: (args = ['FE-123']) => runCapture(['dev-approve', ...args, '--json'], { cwd: repoPath }),
    approvals: () => rows('SELECT * FROM approvals WHERE run_id = ? ORDER BY id', 'run-1'),
    eventCount: () => Number(rows('SELECT COUNT(*) AS n FROM events WHERE run_id = ?', 'run-1')[0]?.n),
  };
}
