import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';

import { runSteps, type RunStepsOutcome } from '../../src/run-state/step-runner.js';
import { createWorktree } from '../../src/worktree/create.js';
import type { StepResult } from '../../src/worker-runtime/types.js';
import type { WriteScopeConfig } from '../../src/write-scope/types.js';
import { runStateFixture, stepSpec, type RunStateFixture } from './run-state.js';
import { eventsOf } from './worktree-fixture.js';
import { stepRequest } from './worker-runtime.js';

/** A merged-config slice with nothing protected, nothing overridden and nothing ignored. */
export function scopeConfig(overrides: Partial<WriteScopeConfig> = {}): WriteScopeConfig {
  return { protected_globs: [], role_write_globs: {}, snapshot_ignore: [], ...overrides };
}

export interface WriteScopeFixture {
  state: RunStateFixture;
  env: NodeJS.ProcessEnv;
  /** A FAC-17 worktree of `example-frontend` / `FE-123` under the cache root of the temp factory home, at the base commit and clean. */
  worktree: string;
  baseCommit: string;
  /** An empty folder inside the temp home for the temporary index file of a snapshot. */
  scratch: string;
  /** Plays a scenario once in the worktree with the fake worker through the real Spawner, outside the step runner. */
  play: (scenario: string, role?: string) => Promise<StepResult>;
  /** Runs one step of `role` through `runSteps` in `building`, with write-scope on. */
  runScoped: (scenario: string, role: string, config?: WriteScopeConfig) => Promise<RunStepsOutcome>;
  /** The `write_scope` events of run-1 with their check rows (sorted by item), oldest first. */
  writeScopeEvents: () => Array<{ rows: Array<{ item: string; ok: boolean }> }>;
}

/**
 * Run `run-1` in `building` with a real linked worktree created through the FAC-17 helper under the cache
 * folder, and a fake worker (`createFakeWorkerRuntime`) for every scenario. Call `cleanupRunStateTest` from afterEach.
 */
export function writeScopeFixture(): WriteScopeFixture {
  const state = runStateFixture();
  createWorktree(state.fx.options());
  state.arrange('building');
  const worktree = state.worktree;
  expect(worktree.startsWith(`${join(state.fx.sb.home, 'cache', 'worktrees')}/`)).toBe(true);
  expect(existsSync(join(worktree, '.git'))).toBe(true);
  const scratch = join(state.fx.sb.tmp, 'scratch');
  mkdirSync(scratch, { recursive: true });

  const play: WriteScopeFixture['play'] = async (scenario, role = 'builder') => {
    const worker = state.scenarioRuntime(scenario);
    expect(worker.runtime.id).toBe('fake-worker');
    const result = await worker.runtime.start(stepRequest(worktree, { role })).result;
    expect(result.exitReason).toBe('ok');
    return result;
  };

  return {
    state,
    env: state.fx.sb.env,
    worktree,
    baseCommit: state.fx.repo.baseCommit,
    scratch,
    play,
    runScoped: (scenario, role, config = scopeConfig()) => {
      const worker = state.scenarioRuntime(scenario);
      expect(worker.runtime.id).toBe('fake-worker');
      return runSteps({
        ...state.context,
        runtime: worker.runtime,
        runId: 'run-1',
        phase: 'building',
        cwd: worktree,
        steps: [stepSpec('step', { role })],
        writeScope: { config, tempDir: scratch },
      });
    },
    writeScopeEvents: () =>
      eventsOf(state.fx.reader, 'run-1', 'write_scope').map((event) => ({
        rows: state.rows('SELECT item, ok FROM check_rows WHERE event_id = ? ORDER BY item', event.id).map((row) => ({
          item: String(row.item),
          ok: Number(row.ok) === 1,
        })),
      })),
  };
}
