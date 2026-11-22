import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { writeReport } from '../../src/run-folder/report.js';
import { runSteps } from '../../src/run-state/step-runner.js';
import { cleanupRunStateTest, stepSpec, type RunStateFixture } from '../support/run-state.js';
import { cappedBuilding, costOptions, MINUTE_MS, nextActionSection } from '../support/cost.js';

afterEach(cleanupRunStateTest);

function reportOf(state: RunStateFixture): string {
  const path = writeReport({ env: state.fx.sb.env, log: state.fx.reader, runId: 'run-1', worktreePath: state.worktree });
  expect(path).toBe(join(state.runFolder, 'report.md'));
  return readFileSync(path, 'utf8');
}

describe('reaching a cap stops the run as budget or timeout, keeps the worktree, and says what to do next', () => {
  test('when summed cost reaches the effective dollar cap the run stops as budget, the worktree is still there, and the report or error names the spend and factory resume with --cap', async () => {
    // Each step reports $1.25; the cap of $2.50 is reached by the second one, so the third never starts.
    const { state, worker, options } = cappedBuilding('usage-reported-cost', { capUsd: 2.5 });

    const outcome = await runSteps(options([stepSpec('first'), stepSpec('second'), stepSpec('third')]));

    expect(outcome.status).toBe('budget');
    expect(state.status()).toBe('budget');
    expect(worker.requests.map((request) => request.stepId)).toEqual(['first', 'second']);
    expect(existsSync(state.worktree)).toBe(true);
    const next = nextActionSection(reportOf(state));
    expect(next).toContain('$2.50');
    expect(next).toContain('factory resume FE-123');
    expect(next).toContain('--cap');
  });

  test('when elapsed wall-clock reaches the flow minutes the run stops as timeout, the worktree is still there, and the report or error names the elapsed time and the next action', async () => {
    // The first step takes the whole 30 minutes of the flow, so the second never starts.
    const { state, worker, options } = cappedBuilding('session-id', {
      capUsd: 5,
      cost: costOptions({ minutes: 30, expectedUsage: [] }),
      onStart: (current, request) => {
        if (request.stepId === 'first') current.fx.deps.advance(30 * MINUTE_MS);
      },
    });

    const outcome = await runSteps(options([stepSpec('first'), stepSpec('second')]));

    expect(outcome.status).toBe('timeout');
    expect(state.status()).toBe('timeout');
    expect(worker.requests.map((request) => request.stepId)).toEqual(['first']);
    expect(existsSync(state.worktree)).toBe(true);
    const next = nextActionSection(reportOf(state));
    expect(next).toContain('30 min');
    expect(next).toContain('factory resume FE-123');
  });

  test("a step's timeoutMs is tightened to the wall-clock that remains in the run", async () => {
    const { state, worker, options } = cappedBuilding('session-id', {
      capUsd: 5,
      cost: costOptions({ minutes: 30, expectedUsage: [] }),
    });
    state.fx.deps.advance(29 * MINUTE_MS);

    await runSteps(options([stepSpec('implement', { timeoutMs: 600_000 })]));

    expect(worker.requests[0]?.timeoutMs).toBe(MINUTE_MS);
  });
});
