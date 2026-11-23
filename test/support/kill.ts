import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Spawner } from '../../src/ports/spawner.js';
import { createWorktree } from '../../src/worktree/create.js';
import type { RunningStep } from '../../src/worker-runtime/types.js';
import type { FakeDeps } from './fake-deps.js';
import type { RunStateFixture } from './run-state.js';
import { descendantsOf, isAlive, stepRequest, waitFor } from './worker-runtime.js';

export interface RunningWorker {
  step: RunningStep;
  /** Pid of the fake worker child, from its `processes` row. */
  pid: number;
  /** Command text of that row. */
  command: string;
  /** Pids of the grandchildren it started, from `ps`. */
  descendants: number[];
}

/** Ready-file and process-row wait used by every existing caller. */
const READY_TIMEOUT_MS = 4_000;
/** How long a SIGTERM-ignoring worker gets before SIGKILL. Real processes, so this is wall time. */
const TERM_GRACE_MS = 300;
/** Bound for the post-kill wait. Not a test timeout. */
const REAP_MS = 3_000;

export interface StartWorkerOptions {
  /** Ready-file and process-row wait. Omit it and the wait stays 4000 ms. */
  timeoutMs?: number;
  /** Replaces the ready-file check. A test can throw or return false to force the failure path. */
  isReady?: () => boolean | Promise<boolean>;
}

const signalPid = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(pid, signal);
  } catch {
    // Already exited.
  }
};

/**
 * SIGTERM the fake-worker tree, then SIGKILL what is still alive (a worker that ignores SIGTERM),
 * and wait until every pid we saw is gone. `step.kill()` is `killTree`, so a tree that is not in the
 * processes table yet is still stopped once spawn resolves.
 */
async function stopWorkerTree(step: RunningStep, state: RunStateFixture): Promise<void> {
  const row = state.rows('SELECT pid FROM processes')[0];
  const pid = row === undefined ? undefined : Number(row.pid);
  const watched = new Set<number>();

  if (pid !== undefined && Number.isFinite(pid) && pid > 0 && isAlive(pid)) {
    const descendants = await descendantsOf(pid);
    for (const descendant of descendants) watched.add(descendant);
    watched.add(pid);
    for (const descendant of [...descendants].reverse()) signalPid(descendant, 'SIGTERM');
    signalPid(pid, 'SIGTERM');
    await waitFor(() => [...watched].every((candidate) => !isAlive(candidate)), TERM_GRACE_MS).catch(() => undefined);
    const later = isAlive(pid) ? await descendantsOf(pid) : [];
    for (const descendant of later) watched.add(descendant);
    for (const descendant of [...later].reverse()) signalPid(descendant, 'SIGKILL');
    for (const candidate of watched) {
      if (candidate !== pid && isAlive(candidate)) signalPid(candidate, 'SIGKILL');
    }
    if (isAlive(pid)) signalPid(pid, 'SIGKILL');
  }

  await step.kill();
  if (watched.size > 0) {
    await waitFor(() => [...watched].every((candidate) => !isAlive(candidate)), REAP_MS);
  }
}

/**
 * Puts `run-1` in `building` with a real worktree and a fake worker (a scenario under
 * test/fixtures/worker-scenarios/) running in it. The child and its children exist only under the temp home.
 * If the ready wait or the grandchild check throws, the worker tree is stopped before the error propagates.
 */
export async function startWorkerInRun(
  state: RunStateFixture,
  scenario: string,
  expectedChildren = 0,
  options: StartWorkerOptions = {},
): Promise<RunningWorker> {
  const timeoutMs = options.timeoutMs ?? READY_TIMEOUT_MS;
  const isReady = options.isReady ?? (() => existsSync(join(state.worktree, 'ready.txt')));
  createWorktree(state.fx.options());
  state.arrange('building');
  const step = state.scenarioRuntime(scenario).runtime.start(stepRequest(state.worktree));
  try {
    await waitFor(isReady, timeoutMs);
    await waitFor(() => state.rows('SELECT id FROM processes').length > 0, timeoutMs);
    const row = state.rows('SELECT pid, command FROM processes')[0];
    const pid = Number(row?.pid);
    const command = String(row?.command);
    const descendants = await descendantsOf(pid);
    if (descendants.length !== expectedChildren) {
      throw new Error(`expected ${expectedChildren} grandchildren of ${pid}, found ${descendants.length}`);
    }
    return { step, pid, command, descendants };
  } catch (error) {
    try {
      await stopWorkerTree(step, state);
    } catch (cleanupError) {
      throw new Error(`failed to stop the worker after: ${error instanceof Error ? error.message : String(error)}`, {
        cause: cleanupError,
      });
    }
    throw error;
  }
}

/**
 * Drives the fake clock while `promise` is pending, but only while the code under test is waiting in
 * `deps.sleep`. A grace wait then ends after a few ticks instead of 10 s, and the real time that
 * `ps` and signals take never counts as fake time.
 */
export async function withClock<T>(promise: Promise<T>, deps: FakeDeps, tickMs = 100): Promise<T> {
  let settled = false;
  let sleeping = 0;
  const realSleep = deps.sleep;
  deps.sleep = (ms) => {
    sleeping += 1;
    return realSleep(ms).finally(() => {
      sleeping -= 1;
    });
  };
  const watched = promise.finally(() => {
    settled = true;
  });
  watched.catch(() => undefined);
  try {
    while (!settled) {
      if (sleeping > 0) deps.advance(tickMs);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    return await watched;
  } finally {
    deps.sleep = realSleep;
  }
}

export interface SpawnerCall {
  op: 'term' | 'kill';
  pid: number;
  command: string;
  result: 'killed' | 'pid_reused' | 'gone';
}

/** Passes every call through to `inner` and records `termTree` and `killTree` calls in order. */
export function recordingSpawner(inner: Spawner): { spawner: Spawner; calls: SpawnerCall[] } {
  const calls: SpawnerCall[] = [];
  return {
    calls,
    spawner: {
      spawn: (request) => inner.spawn(request),
      termTree: async (pid, command) => {
        const result = await inner.termTree(pid, command);
        calls.push({ op: 'term', pid, command, result });
        return result;
      },
      killTree: async (pid, command) => {
        const result = await inner.killTree(pid, command);
        calls.push({ op: 'kill', pid, command, result });
        return result;
      },
    },
  };
}

/** Resolves once every pid is gone. */
export const allGone = (pids: readonly number[]): Promise<void> =>
  waitFor(() => pids.every((pid) => !isAlive(pid)));
