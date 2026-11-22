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

/**
 * Puts `run-1` in `building` with a real worktree and a fake worker (a scenario under
 * test/fixtures/worker-scenarios/) running in it. The child and its children exist only under the temp home.
 */
export async function startWorkerInRun(
  state: RunStateFixture,
  scenario: string,
  expectedChildren = 0,
): Promise<RunningWorker> {
  createWorktree(state.fx.options());
  state.arrange('building');
  const step = state.scenarioRuntime(scenario).runtime.start(stepRequest(state.worktree));
  await waitFor(() => existsSync(join(state.worktree, 'ready.txt')));
  await waitFor(() => state.rows('SELECT id FROM processes').length > 0);
  const row = state.rows('SELECT pid, command FROM processes')[0];
  const pid = Number(row?.pid);
  const command = String(row?.command);
  const descendants = await descendantsOf(pid);
  if (descendants.length !== expectedChildren) {
    throw new Error(`expected ${expectedChildren} grandchildren of ${pid}, found ${descendants.length}`);
  }
  return { step, pid, command, descendants };
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
