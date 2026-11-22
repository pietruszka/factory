import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { canPassFromReport } from '../../src/run-folder/report.js';
import { runStubPlan } from '../../src/run-state/stub-pipeline.js';
import { createWorktree } from '../../src/worktree/create.js';
import { cleanupRunStateTest, driveStubPipeline, runStateFixture, STOP_STATUSES } from '../support/run-state.js';

afterEach(cleanupRunStateTest);

describe('a fake-worker stub pipeline reaches awaiting_approval, then a terminal or stop status', () => {
  test('after a stub plan step the run is awaiting_approval', async () => {
    const state = runStateFixture();
    createWorktree(state.fx.options());
    const plan = state.scenarioRuntime('final-json');

    const status = await runStubPlan({ ...state.context, runtime: plan.runtime, runId: 'run-1', worktree: state.worktree });

    expect(status).toBe('awaiting_approval');
    expect(state.status()).toBe('awaiting_approval');
    expect(plan.requests).toHaveLength(1);
    expect(existsSync(join(state.runFolder, 'plan.md'))).toBe(true);
  });

  test('after a test-injected approval and stub build steps the run is passed when the required artifacts are present, or a stop status when a limit is hit', async () => {
    const passing = runStateFixture();
    const stopping = runStateFixture();

    const passed = await driveStubPipeline(passing, 'edits');
    const stopped = await driveStubPipeline(stopping, 'fail');

    expect(passed.planned).toBe('awaiting_approval');
    expect(passed.final).toBe('passed');
    expect(passing.status()).toBe('passed');
    expect(canPassFromReport(passing.runFolder)).toBe(true);
    expect(STOP_STATUSES).toContain(stopped.final);
    expect(stopping.status()).toBe(stopped.final);
  });
});
