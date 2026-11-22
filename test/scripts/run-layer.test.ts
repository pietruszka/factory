import { describe, expect, test } from 'vitest';

import { L3_BUDGET_SECONDS, runLayer } from '../../scripts/run-layer.js';
import { createFakeDeps } from '../support/fake-deps.js';

function setup(elapsedMs: number, vitestExit = 0) {
  const deps = createFakeDeps();
  const printed: string[] = [];
  const vitestArgs: string[][] = [];
  const runVitest = async (args: string[]): Promise<number> => {
    vitestArgs.push(args);
    deps.advance(elapsedMs);
    return vitestExit;
  };
  const run = () =>
    runLayer({ deps, runVitest, print: (line) => printed.push(line), budgetSeconds: L3_BUDGET_SECONDS });
  return { run, printed, vitestArgs };
}

describe('L3 runner', () => {
  test('runLayer with an injected clock reporting 121 s returns exit 1 and prints "L3 took 121 s, budget 120 s"', async () => {
    const { run, printed } = setup(121_000);

    const result = await run();

    expect(result.exitCode).toBe(1);
    expect(printed.join('\n')).toContain('L3 took 121 s, budget 120 s');
  });

  test('119 s passes and prints the time', async () => {
    const { run, printed } = setup(119_000);

    const result = await run();

    expect(result.exitCode).toBe(0);
    expect(printed.join('\n')).toContain('L3 took 119 s');
  });

  test('runLayer runs only the test/l3/ folder, selected by path and not by title', async () => {
    const { run, vitestArgs } = setup(1_000);

    await run();

    expect(vitestArgs[0]).toEqual(['run', 'test/l3/', '--passWithNoTests']);
  });

  test('a failing vitest run fails the layer even when it is within budget', async () => {
    const { run, printed } = setup(0, 1);

    const result = await run();

    expect(result.exitCode).toBe(1);
    expect(printed.join('\n')).toContain('L3 took 0 s');
  });

  test('the L3 budget is 120 s', () => {
    expect(L3_BUDGET_SECONDS).toBe(120);
  });
});
