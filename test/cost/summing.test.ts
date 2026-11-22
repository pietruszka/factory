import { afterEach, describe, expect, test } from 'vitest';

import { checkCaps } from '../../src/cost/caps.js';
import { cleanupRunStateTest, runStateFixture } from '../support/run-state.js';
import { MINUTE_MS } from '../support/cost.js';
import { START_TIME } from '../support/worktree-fixture.js';

afterEach(cleanupRunStateTest);

describe('cost and time are summed across attempts', () => {
  test('cost from two attempts of the same run is summed when checking the dollar cap', () => {
    const state = runStateFixture({ run: { cap_usd_effective: 5 } });
    const base = { run_id: 'run-1', type: 'usage', step: 'implement' };
    state.fx.log.appendEvent({ ...base, attempt: 1, cost_usd: 3, usage_source: 'reported' });
    // An event with no cost is never counted as zero and never changes the sum.
    state.fx.log.appendEvent({ ...base, step: 'review', attempt: 1 });

    const first = checkCaps({ ...state.context, runId: 'run-1', minutes: 30 });
    expect(first).toMatchObject({ kind: 'within', spentUsd: 3 });

    state.fx.log.appendEvent({ ...base, attempt: 2, cost_usd: 3, usage_source: 'estimated' });

    const second = checkCaps({ ...state.context, runId: 'run-1', minutes: 30 });
    expect(second).toMatchObject({ kind: 'budget', spentUsd: 6, capUsd: 5 });
  });

  test('wall-clock from the run start, including a recorded install interval, is summed when checking the time cap', () => {
    const state = runStateFixture({ run: { cap_usd_effective: 5 } });
    state.fx.log.appendEvent({
      run_id: 'run-1',
      type: 'worktree_install',
      status: 'ok',
      started_at: state.fx.deps.toIso(START_TIME + MINUTE_MS),
      ended_at: state.fx.deps.toIso(START_TIME + 11 * MINUTE_MS),
      payload: { path: state.worktree, exit_code: 0 },
    });
    state.fx.deps.advance(12 * MINUTE_MS);

    // Outside the install the run used 2 minutes, so only the install interval can push it past 10.
    const tight = checkCaps({ ...state.context, runId: 'run-1', minutes: 10 });
    expect(tight).toMatchObject({ kind: 'timeout', elapsedMs: 12 * MINUTE_MS, capMinutes: 10 });

    const roomy = checkCaps({ ...state.context, runId: 'run-1', minutes: 15 });
    expect(roomy).toMatchObject({ kind: 'within', elapsedMs: 12 * MINUTE_MS });
  });
});
