import { afterEach, describe, expect, test } from 'vitest';

import { normaliseUsage } from '../../src/cost/usage.js';
import { runSteps } from '../../src/run-state/step-runner.js';
import { cleanupRunStateTest, stepSpec } from '../support/run-state.js';
import { cappedBuilding, costOptions, costRows, EXAMPLE_RATES } from '../support/cost.js';

afterEach(cleanupRunStateTest);

const STEP_ROWS = 'SELECT step, attempt, status, exit_reason FROM steps ORDER BY step, attempt';

describe('a usage event without an expected field fails as cost_missing and is never counted as zero', () => {
  test('a missing expected usage field fails the step as cost_missing, moves the run to cost_missing, and writes no cost_usd of zero', async () => {
    const { state, options } = cappedBuilding('usage-missing', { capUsd: 5, cost: costOptions({ expectedUsage: ['tokens'] }) });

    const outcome = await runSteps(options([stepSpec('implement')]));

    expect(outcome.status).toBe('cost_missing');
    expect(state.status()).toBe('cost_missing');
    expect(state.rows(STEP_ROWS)).toEqual([{ step: 'implement', attempt: 1, status: 'failed', exit_reason: 'cost_missing' }]);
    expect(costRows(state)).toEqual([]);
  });

  test('tokens that the rate table cannot price fail the step as cost_missing and write no cost_usd', async () => {
    const { state, options } = cappedBuilding('usage-full', { capUsd: 5, cost: costOptions({ rateTable: {} }) });

    const outcome = await runSteps(options([stepSpec('implement')]));

    expect(outcome.status).toBe('cost_missing');
    expect(state.rows(STEP_ROWS)).toEqual([{ step: 'implement', attempt: 1, status: 'failed', exit_reason: 'cost_missing' }]);
    expect(costRows(state)).toEqual([]);
  });

  test('a genuine reported cost of zero is stored as reported zero and is not treated as cost_missing', async () => {
    const { state, options } = cappedBuilding('usage-reported-zero', { capUsd: 5, cost: costOptions({ expectedUsage: ['cost'] }) });

    const outcome = await runSteps(options([stepSpec('implement')]));

    expect(outcome.status).toBe('building');
    expect(state.rows(STEP_ROWS)).toEqual([{ step: 'implement', attempt: 1, status: 'done', exit_reason: 'ok' }]);
    expect(costRows(state)).toEqual([{ step: 'implement', attempt: 1, cost_usd: 0, usage_source: 'reported' }]);
  });

  test('normalising a step with no usage when tokens are expected is missing, not a zero cost', () => {
    const outcome = normaliseUsage({ result: {}, model: 'example-model', rateTable: EXAMPLE_RATES, expectedUsage: ['tokens'] });

    expect(outcome).toEqual({ kind: 'missing', fields: ['tokens'] });
  });

  test('normalising a reported cost of zero when cost is expected is a reported zero', () => {
    const outcome = normaliseUsage({ result: { costUsd: 0 }, model: 'example-model', rateTable: EXAMPLE_RATES, expectedUsage: ['cost'] });

    expect(outcome).toEqual({ kind: 'priced', costUsd: 0, usageSource: 'reported' });
  });
});
