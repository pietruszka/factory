import { describe, expect, test, vi } from 'vitest';

import { assertLive, Budget, BudgetExceeded } from '../../src/dev/live-guard.js';

describe('assertLive', () => {
  test('throws when FACTORY_LIVE is unset and does not spawn work', () => {
    const spawn = vi.fn();

    const run = (): void => {
      assertLive({});
      spawn();
    };

    expect(run).toThrow(/FACTORY_LIVE/);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('Budget', () => {
  test('throws BudgetExceeded at exactly $1 by default', () => {
    const budget = new Budget();

    expect(() => budget.add(1)).toThrow(BudgetExceeded);
  });

  test('throws when total reaches the cap across multiple calls', () => {
    const budget = new Budget(1);

    budget.add(0.4);
    budget.add(0.5);
    expect(() => budget.add(0.1)).toThrow(BudgetExceeded);
  });

  test('throws when adding fractional dollars repeatedly reaches cap', () => {
    const budget = new Budget(1);

    for (let index = 0; index < 9; index += 1) {
      budget.add(0.1);
    }

    expect(() => budget.add(0.1)).toThrow(BudgetExceeded);
  });

  test.each([NaN, 0, -1, Number.POSITIVE_INFINITY])(
    'refuses an invalid cap: %s',
    (cap) => {
      expect(() => new Budget(cap)).toThrow(/cap/i);
    },
  );
});
