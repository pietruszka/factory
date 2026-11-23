import { describe, expect, test } from 'vitest';

import { cleanupL3Scenarios, startBlockedResumeChild } from '../support/l3-scenarios.js';
import { isAlive } from '../support/worker-runtime.js';

describe('a crashed resume child', () => {
  test('a crashed resume-child tree is gone after afterEach', async () => {
    const started = await startBlockedResumeChild();
    expect(started.pids).toContain(started.parentPid);
    expect(started.pids).toContain(started.workerPid);
    expect(started.parentPid).not.toBe(started.workerPid);
    expect(isAlive(started.parentPid)).toBe(true);
    expect(isAlive(started.workerPid)).toBe(true);

    const abandon = async (): Promise<void> => {
      throw new Error('mid-flight');
    };

    try {
      await expect(abandon()).rejects.toThrow('mid-flight');
      await cleanupL3Scenarios();
      expect(started.pids.every((pid) => !isAlive(pid))).toBe(true);
    } finally {
      await cleanupL3Scenarios();
    }
  }, 60_000);
});
