import { describe, expect, test } from 'vitest';

import {
  runBreachScenario,
  runCapStopScenario,
  runCostMissingScenario,
  runCrashResumeScenario,
  runKillScenario,
  runRetentionScenario,
} from '../support/l3-scenarios.js';

describe('the M1 exit scenarios', () => {
  test('a write-scope breach is detected at L3', async () => {
    const result = await runBreachScenario();

    expect(result.runStatus).toBe('breach');
    expect(result.stepExitReason).toBe('breach');
    expect(result.writeScopeRows).toEqual([{ item: 'src/app.ts', ok: false }]);
    expect(result.fileRestored).toBe(true);
  });

  test('a cap stop is detected at L3', async () => {
    const result = await runCapStopScenario();

    expect(result.runStatus).toBe('budget');
    expect(result.startedSteps).toEqual(['first', 'second']);
    expect(result.worktreeKept).toBe(true);
    expect(result.nextAction).toContain('$2.50');
    expect(result.nextAction).toContain('factory resume FE-123');
    expect(result.nextAction).toContain('--cap');
  });

  test('a cost_missing stop is detected at L3', async () => {
    const result = await runCostMissingScenario();

    expect(result.runStatus).toBe('cost_missing');
    expect(result.stepExitReason).toBe('cost_missing');
    expect(result.costRows).toEqual([]);
  });

  test('factory kill stops a run at L3', async () => {
    const result = await runKillScenario();

    expect(result.exitCode).toBe(0);
    expect(result.runStatus).toBe('killed');
    expect(result.processesGone).toBe(true);
    expect(result.worktreeKept).toBe(true);
    expect(result.nextCommand).toBe('factory resume FE-123');
  }, 30_000);

  test('a crash then resume is detected at L3', async () => {
    const result = await runCrashResumeScenario();

    expect(result.statusAfterCrash).toBe('building');
    expect(result.resumeExitCode).toBe(0);
    expect(result.resumeStatus).toBe('passed');
    expect(result.ran).toEqual(['implement', 'verify', 'review']);
    expect(result.skipped).toEqual(['prepare']);
    expect(result.implementAttempts).toEqual([1, 2]);
    expect(result.crashedWorkerStopped).toBe(true);
  }, 90_000);

  test('retention cleanup is detected at L3', async () => {
    const result = await runRetentionScenario();

    expect(result.cleanedRuns).toEqual(['run-a']);
    expect(result.oldArtifactsGone).toBe(true);
    expect(result.keptFilesIntact).toBe(true);
    expect(result.runFolderKept).toBe(true);
    expect(result.recentRunUntouched).toBe(true);
    expect(result.retentionEvents).toBe(1);
  });
});
