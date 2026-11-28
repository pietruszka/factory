// Drivers for the six M1 exit scenarios at L3. Each one wraps the existing fixtures and libraries
// (write-scope, cost, kill, resume, retention) under a temp home with the fake worker, and returns plain
// facts the L3 test can check. Nothing here starts a live worker, gh or acli.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';

import { runCommand } from '../../src/ports/run-command.js';
import { writeReport } from '../../src/run-folder/report.js';
import { runSteps } from '../../src/run-state/step-runner.js';
import { parseEnvelope, runCapture } from './cli-harness.js';
import { cappedBuilding, costOptions, costRows, nextActionSection } from './cost.js';
import { allGone, startWorkerInRun } from './kill.js';
import {
  contentsUnder,
  DAY,
  filesUnder,
  KEPT_FILES,
  OLD_ARTIFACTS,
  retentionFixture,
} from './retention.js';
import { stoppedRun } from './resume.js';
import { cleanupRunStateTest, runStateFixture, stepSpec, type RunStateFixture } from './run-state.js';
import { cleanupStatusTest, pointEnvAt } from './status.js';
import { descendantsOf, isAlive, waitFor } from './worker-runtime.js';
import { eventsOf } from './worktree-fixture.js';
import { writeScopeFixture } from './write-scope.js';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const RESUME_CHILD = join(repoRoot, 'test', 'support', 'resume-child.ts');
const SCENARIOS = join(repoRoot, 'test', 'fixtures', 'worker-scenarios');
const APP_TS = 'export const app = 1;\n';

/** Factory children the crash driver started, and the latch files that release their fake workers. */
const crashChildren: ChildProcess[] = [];
const crashLatches: string[] = [];
/** Pids recorded while the factory child was alive, so a reparented worker can still be stopped. */
const trackedPids: number[] = [];

/** How long the latch gets to release the worker before SIGKILL. Short, so resume cannot start another worker. */
const LATCH_GRACE_MS = 50;
/** Bound for the post-kill wait. Not a test timeout. */
const REAP_MS = 3_000;

const signalPid = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(pid, signal);
  } catch {
    // Already exited.
  }
};

const trackCrashPids = (pids: readonly number[]): void => {
  for (const pid of pids) {
    if (Number.isFinite(pid) && pid > 0 && !trackedPids.includes(pid)) trackedPids.push(pid);
  }
};

const commandOf = async (pid: number): Promise<string> => {
  const { stdout, exitCode } = await runCommand('ps', ['-p', String(pid), '-o', 'command=']);
  return exitCode === 0 ? stdout.trim() : '';
};

const isFactoryTestProcess = (command: string): boolean =>
  command.includes('fake-worker-child') || command.includes('resume-child');

/**
 * Writes the latch, then SIGKILLs the resume-child tree and any fake worker it started, including
 * descendants that have been reparented, and waits until those pids are gone.
 */
const releaseCrashChildren = async (): Promise<void> => {
  for (const latch of crashLatches.splice(0)) {
    if (existsSync(dirname(latch))) writeFileSync(latch, 'release\n');
  }

  const children = crashChildren.splice(0);
  const tracked = trackedPids.splice(0);
  try {
    const roots = new Set<number>();
    for (const child of children) {
      const pid = child.pid;
      if (pid === undefined || child.exitCode !== null || child.signalCode !== null) continue;
      roots.add(pid);
    }
    for (const pid of tracked) {
      if (!isAlive(pid)) continue;
      if (isFactoryTestProcess(await commandOf(pid))) roots.add(pid);
    }

    const watched = new Set<number>();
    for (const root of roots) {
      if (!isAlive(root)) continue;
      watched.add(root);
      for (const descendant of await descendantsOf(root)) watched.add(descendant);
    }

    const pids = [...watched];
    if (pids.length > 0) {
      await waitFor(() => pids.every((pid) => !isAlive(pid)), LATCH_GRACE_MS).catch(() => undefined);
    }

    const stillRoots = [...roots].filter((pid) => isAlive(pid));
    for (const root of stillRoots) {
      for (const descendant of await descendantsOf(root)) watched.add(descendant);
    }
    const rootSet = new Set(stillRoots);
    for (const pid of watched) {
      if (!rootSet.has(pid) && isAlive(pid)) signalPid(pid, 'SIGKILL');
    }
    for (const pid of stillRoots) signalPid(pid, 'SIGKILL');

    if (watched.size > 0) {
      await waitFor(() => [...watched].every((pid) => !isAlive(pid)), REAP_MS);
    }
  } catch (error) {
    for (const child of children) crashChildren.push(child);
    trackCrashPids(tracked);
    throw error;
  }
};

/** The crash-driver afterEach: release every resume child, then the temp homes. */
export async function cleanupL3Scenarios(): Promise<void> {
  await releaseCrashChildren();
  await cleanupRunStateTest();
  cleanupStatusTest();
}

afterEach(cleanupL3Scenarios);

export interface BlockedResumeChild {
  parentPid: number;
  workerPid: number;
  /** The factory child, the fake worker, and every descendant seen once the worker was ready. */
  pids: number[];
}

/**
 * Starts the crash-shaped factory child (latch, ready worker) and leaves it running.
 * `cleanupL3Scenarios` stops the tree. A caller that throws after this returns is the mid-flight failure.
 */
export async function startBlockedResumeChild(): Promise<BlockedResumeChild> {
  const state = runStateFixture();
  stoppedRun(state, { left: 'building', steps: [{ step: 'prepare', status: 'done' }] });
  const ready = join(state.worktree, 'ready.txt');
  crashLatches.push(join(state.worktree, 'latch.txt'));
  const child = startFactoryChild(state, 'latch');
  await waitUntilBlocked(child, ready);
  const blocked = state.rows('SELECT pid, ended_at FROM processes WHERE run_id = ?', 'run-1');
  const workerPid = Number(blocked[0]?.pid);
  if (blocked.length !== 1 || blocked[0]?.ended_at !== null || !Number.isFinite(workerPid)) {
    throw new Error(`expected one open worker process, found ${JSON.stringify(blocked)}`);
  }
  const parentPid = child.process.pid;
  if (parentPid === undefined) throw new Error('factory child has no pid');
  const descendants = await descendantsOf(parentPid);
  const workerDescendants = await descendantsOf(workerPid);
  const pids = [...new Set([parentPid, workerPid, ...descendants, ...workerDescendants])];
  trackCrashPids(pids);
  return { parentPid, workerPid, pids };
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const sameFiles = (before: Record<string, string>, after: Record<string, string>): boolean => {
  const beforeNames = Object.keys(before);
  const afterNames = Object.keys(after);
  return beforeNames.length === afterNames.length && beforeNames.every((name) => after[name] === before[name]);
};

export interface BreachResult {
  /** `runs.status` after a planner wrote a code file. */
  runStatus: string;
  /** The `exit_reason` of the failed step. */
  stepExitReason: string;
  /** The `write_scope` event rows (path and whether it was allowed). */
  writeScopeRows: Array<{ item: string; ok: boolean }>;
  /** True when the edited file has its original content again. */
  fileRestored: boolean;
}

/** A planner step that edits a worktree code file, through the step runner with write-scope on. */
export const runBreachScenario = async (): Promise<BreachResult> => {
  const scope = writeScopeFixture();
  await scope.runScoped('scope-code-edit', 'planner');
  const step = scope.state.rows('SELECT exit_reason FROM steps ORDER BY attempt')[0];
  return {
    runStatus: scope.state.status(),
    stepExitReason: text(step?.exit_reason),
    writeScopeRows: scope.writeScopeEvents().flatMap((event) => event.rows),
    fileRestored: readFileSync(join(scope.worktree, 'src/app.ts'), 'utf8') === APP_TS,
  };
};

export interface CapStopResult {
  runStatus: string;
  /** Step ids the fake worker was started for, in order. */
  startedSteps: string[];
  worktreeKept: boolean;
  /** The "next action" section of the written report. */
  nextAction: string;
}

/** Steps that report $1.25 each against a $2.50 cap, so the third step never starts. */
export const runCapStopScenario = async (): Promise<CapStopResult> => {
  const { state, worker, options } = cappedBuilding('usage-reported-cost', { capUsd: 2.5 });
  await runSteps(options([stepSpec('first'), stepSpec('second'), stepSpec('third')]));
  const reportPath = writeReport({
    env: state.fx.sb.env,
    log: state.fx.reader,
    runId: 'run-1',
    worktreePath: state.worktree,
  });
  return {
    runStatus: state.status(),
    startedSteps: worker.requests.map((request) => request.stepId),
    worktreeKept: existsSync(state.worktree),
    nextAction: nextActionSection(readFileSync(reportPath, 'utf8')) ?? '',
  };
};

export interface CostMissingResult {
  runStatus: string;
  stepExitReason: string;
  /** Event rows that carry a `cost_usd`. A missing cost is never written as zero. */
  costRows: unknown[];
}

/** A step whose usage lacks an expected field. */
export const runCostMissingScenario = async (): Promise<CostMissingResult> => {
  const { state, options } = cappedBuilding('usage-missing', {
    capUsd: 5,
    cost: costOptions({ expectedUsage: ['tokens'] }),
  });
  await runSteps(options([stepSpec('implement')]));
  const step = state.rows('SELECT exit_reason FROM steps ORDER BY attempt')[0];
  return {
    runStatus: state.status(),
    stepExitReason: text(step?.exit_reason),
    costRows: costRows(state),
  };
};

export interface KillResult {
  /** Exit code of `factory kill FE-123` run through the CLI core. */
  exitCode: number;
  runStatus: string;
  /** True when the fake worker and its children are gone. */
  processesGone: boolean;
  worktreeKept: boolean;
  nextCommand: string | null;
}

/** A running fake worker with children, stopped by `factory kill FE-123`. */
export const runKillScenario = async (): Promise<KillResult> => {
  const state = runStateFixture();
  pointEnvAt(state.fx.sb);
  const worker = await startWorkerInRun(state, 'children', 2);
  const run = await runCapture(['kill', 'FE-123', '--json'], { cwd: state.fx.repo.path });
  const pids = [worker.pid, ...worker.descendants];
  await allGone(pids);
  await worker.step.result;
  return {
    exitCode: run.exitCode,
    runStatus: state.status(),
    processesGone: pids.every((pid) => !isAlive(pid)),
    worktreeKept: existsSync(state.worktree),
    nextCommand: parseEnvelope(run).next_command,
  };
};

export interface CrashResumeResult {
  /** `runs.status` after the factory child was killed with SIGKILL: still the phase it was in. */
  statusAfterCrash: string;
  /** Exit code of the child that resumed the run. */
  resumeExitCode: number | null;
  resumeStatus: string;
  ran: string[];
  skipped: string[];
  /** The attempts of the `implement` step. */
  implementAttempts: number[];
  /** True when the blocked worker of the crashed attempt was stopped. */
  crashedWorkerStopped: boolean;
}

interface FactoryChild {
  process: ChildProcess;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  output: () => { stdout: string; stderr: string };
}

/** Starts the production resume entry (`resumeRun`) as a child, the same way the crash fixture does. */
function startFactoryChild(state: RunStateFixture, scenario: string): FactoryChild {
  let stdout = '';
  let stderr = '';
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', RESUME_CHILD, JSON.stringify({ scenarioPath: join(SCENARIOS, `${scenario}.json`) })],
    {
      cwd: repoRoot,
      env: { PATH: process.env.PATH ?? '', HOME: state.fx.sb.tmp, FACTORY_HOME: state.fx.sb.home },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  crashChildren.push(child);
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => {
    child.on('exit', (code, signal) => done({ code, signal }));
  });
  return { process: child, exited, output: () => ({ stdout, stderr }) };
}

/** Waits for the fake worker's ready file. A child that exits first fails the wait with its own error output. */
async function waitUntilBlocked(child: FactoryChild, readyFile: string): Promise<void> {
  let early: string | undefined;
  void child.exited.then(({ code }) => {
    if (!existsSync(readyFile)) {
      early = `the factory child exited with ${String(code)} before the worker was ready:\n${child.output().stderr}`;
    }
  });
  await waitFor(() => {
    if (early !== undefined) throw new Error(early);
    return existsSync(readyFile);
  }, 30_000);
}

/** A crashed factory child with a fake worker blocked on a latch, then the production resume entry. */
export const runCrashResumeScenario = async (): Promise<CrashResumeResult> => {
  const state = runStateFixture();
  stoppedRun(state, { left: 'building', steps: [{ step: 'prepare', status: 'done' }] });
  const ready = join(state.worktree, 'ready.txt');
  crashLatches.push(join(state.worktree, 'latch.txt'));

  const first = startFactoryChild(state, 'latch');
  await waitUntilBlocked(first, ready);
  const blocked = state.rows('SELECT pid, ended_at FROM processes WHERE run_id = ?', 'run-1');
  const workerPid = Number(blocked[0]?.pid);
  if (blocked.length !== 1 || blocked[0]?.ended_at !== null) {
    throw new Error(`expected one open worker process, found ${JSON.stringify(blocked)}`);
  }
  const parentPid = first.process.pid;
  if (parentPid !== undefined) {
    trackCrashPids([parentPid, workerPid, ...(await descendantsOf(parentPid)), ...(await descendantsOf(workerPid))]);
  }
  first.process.kill('SIGKILL');
  await first.exited;
  const statusAfterCrash = state.status();

  const second = startFactoryChild(state, 'session-id');
  const result = await second.exited;
  const outcome = JSON.parse(second.output().stdout.trim()) as { status?: string; ran?: string[]; skipped?: string[] };
  const attempts = state
    .rows("SELECT attempt FROM steps WHERE step = 'implement' ORDER BY attempt")
    .map((row) => Number(row.attempt));
  const endedAt = state.rows('SELECT ended_at FROM processes WHERE pid = ?', workerPid)[0]?.ended_at;

  return {
    statusAfterCrash,
    resumeExitCode: result.code,
    resumeStatus: text(outcome.status),
    ran: outcome.ran ?? [],
    skipped: outcome.skipped ?? [],
    implementAttempts: attempts,
    crashedWorkerStopped: !isAlive(workerPid) && endedAt !== null && endedAt !== undefined,
  };
};

export interface RetentionScenarioResult {
  /** Run ids whose artifacts the cleanup removed. */
  cleanedRuns: string[];
  /** True when every file under evidence/, prompts/ and ticket.json of the old run is gone. */
  oldArtifactsGone: boolean;
  /** True when the kept files of the old run still hold their content. */
  keptFilesIntact: boolean;
  runFolderKept: boolean;
  /** True when a run that ended less than 30 days ago keeps its artifacts. */
  recentRunUntouched: boolean;
  retentionEvents: number;
}

/**
 * A run that ended 31 days ago and one that ended a day ago, cleaned with `applyRetention` on the injected clock.
 * The two runs use different tickets so each has its own run folder. A shared folder is a separate case.
 */
export const runRetentionScenario = async (): Promise<RetentionScenarioResult> => {
  const fx = retentionFixture();
  const old = fx.seed({ runId: 'run-a', ticket: 'FE-201', worktree: false, endedAgoMs: 31 * DAY });
  const recent = fx.seed({ runId: 'run-b', ticket: 'FE-202', worktree: false, endedAgoMs: DAY });
  const keptBefore = Object.fromEntries(KEPT_FILES.map((name) => [name, contentsUnder(old.runFolder)[name] ?? '']));
  const recentBefore = contentsUnder(recent.runFolder);

  const result = await fx.clean();

  const oldAfter = contentsUnder(old.runFolder);
  return {
    cleanedRuns: result.artifacts_deleted.map((entry) => entry.run_id),
    oldArtifactsGone: OLD_ARTIFACTS.every((name) => !existsSync(join(old.runFolder, name))) &&
      filesUnder(join(old.runFolder, 'evidence')).length === 0 &&
      filesUnder(join(old.runFolder, 'prompts')).length === 0,
    keptFilesIntact: sameFiles(keptBefore, oldAfter),
    runFolderKept: existsSync(old.runFolder),
    recentRunUntouched: sameFiles(recentBefore, contentsUnder(recent.runFolder)),
    retentionEvents: eventsOf(fx.reader, 'run-a', 'retention_cleaned').length,
  };
};
