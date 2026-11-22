import { afterEach, describe, expect, test } from 'vitest';

import { normaliseUsage } from '../../src/cost/usage.js';
import { runSteps } from '../../src/run-state/step-runner.js';
import { cleanupRunStateTest, stepSpec } from '../support/run-state.js';
import { cappedBuilding, costOptions, costRows, EXAMPLE_RATES } from '../support/cost.js';

afterEach(cleanupRunStateTest);

describe("a step's cost is marked reported or estimated", () => {
  test('a CLI-reported numeric cost is stored as reported and is used for the cap', async () => {
    const { state, options } = cappedBuilding('usage-reported-cost', { capUsd: 1 });

    const outcome = await runSteps(options([stepSpec('implement')]));

    expect(costRows(state)).toEqual([{ step: 'implement', attempt: 1, cost_usd: 1.25, usage_source: 'reported' }]);
    expect(outcome.status).toBe('budget');
    expect(state.status()).toBe('budget');
  });

  test('tokens without a reported cost are priced from the config rate_table, stored as estimated, and used for the cap', async () => {
    const { state, options } = cappedBuilding('usage-large-tokens', { capUsd: 5 });

    const outcome = await runSteps(options([stepSpec('implement')]));

    // 1,000,000 input tokens at $2 plus 500,000 output tokens at $8 per 1M.
    const rows = costRows(state);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ step: 'implement', attempt: 1, usage_source: 'estimated' });
    expect(rows[0]?.cost_usd).toBeCloseTo(6, 6);
    expect(outcome.status).toBe('budget');
  });

  test('normalising a reported cost keeps it and flags it reported', () => {
    const outcome = normaliseUsage({
      result: { usage: { inputTokens: 120, outputTokens: 30 }, costUsd: 1.25 },
      model: 'example-model',
      rateTable: EXAMPLE_RATES,
      expectedUsage: ['tokens'],
    });

    expect(outcome).toEqual({ kind: 'priced', costUsd: 1.25, usageSource: 'reported' });
  });

  test('normalising tokens with no reported cost prices them from the rate table and flags them estimated', () => {
    const outcome = normaliseUsage({
      result: { usage: { inputTokens: 1_000_000, outputTokens: 500_000 } },
      model: 'example-model',
      rateTable: costOptions().rateTable,
      expectedUsage: ['tokens'],
    });

    expect(outcome).toMatchObject({ kind: 'priced', usageSource: 'estimated' });
    expect((outcome as { costUsd: number }).costUsd).toBeCloseTo(6, 6);
  });
});
