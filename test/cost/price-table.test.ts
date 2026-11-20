import { describe, expect, test } from 'vitest';

import { estimateCost, PRICE_TABLE } from '../../src/cost/price-table.js';

describe('estimateCost', () => {
  test('returns unknown when the model price is not known', () => {
    const result = estimateCost(
      {
        inputTokens: 1000,
        outputTokens: 200,
      },
      'gpt-5.3-codex-high',
    );

    expect(PRICE_TABLE['gpt-5.3-codex-high']?.inputPer1M).toBeNull();
    expect(result).toEqual(
      expect.objectContaining({
        kind: 'unknown',
        model: 'gpt-5.3-codex-high',
      }),
    );
  });

  test('estimates from input, output, and cache-read token usage when price exists', () => {
    const result = estimateCost(
      {
        inputTokens: 1_000_000,
        outputTokens: 2_000_000,
        cacheReadTokens: 3_000_000,
      },
      'claude-opus-5-5-high',
    );

    expect(result).toEqual({
      kind: 'estimated',
      estimated: true,
      model: 'claude-opus-5-5-high',
      usd: 44.6,
      missingPrices: [],
    });
  });

  test('returns unknown when usage shape is empty', () => {
    const result = estimateCost({}, 'claude-opus-5-5-high');
    expect(result).toEqual({
      kind: 'unknown',
      model: 'claude-opus-5-5-high',
    });
  });
});
