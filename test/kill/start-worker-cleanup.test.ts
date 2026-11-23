import { afterEach, describe, expect, test } from 'vitest';

import { startWorkerInRun } from '../support/kill.js';
import { cleanupRunStateTest, runStateFixture } from '../support/run-state.js';
import { descendantsOf, isAlive } from '../support/worker-runtime.js';

afterEach(async () => {
  await cleanupRunStateTest();
});

describe('startWorkerInRun', () => {
  test('startWorkerInRun kills the worker tree when ready wait fails', async () => {
    const state = runStateFixture();
    let captured: number[] = [];

    // The worker ignores SIGTERM and has children. The ready check throws once that tree is up,
    // which is the same failure startWorkerInRun must clean up before it propagates.
    const pending = startWorkerInRun(state, 'ignore-sigterm-children', 2, {
      timeoutMs: 4_000,
      isReady: async () => {
        const row = state.rows('SELECT pid FROM processes')[0];
        if (row === undefined) return false;
        const pid = Number(row.pid);
        const descendants = await descendantsOf(pid);
        if (descendants.length < 2) return false;
        captured = [pid, ...descendants];
        throw new Error('ready wait failed');
      },
    });

    await expect(pending).rejects.toThrow('ready wait failed');
    expect(captured.length).toBeGreaterThanOrEqual(3);
    expect(captured.every((pid) => !isAlive(pid))).toBe(true);
  }, 15_000);
});
