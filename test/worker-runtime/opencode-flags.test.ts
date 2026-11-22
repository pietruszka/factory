import { afterEach, describe, expect, test } from 'vitest';

import { createOpenCodeRuntime } from '../../src/adapters/opencode.js';
import { createFakeProcessTable } from '../../src/ports/process-table.js';
import { createFakeSpawner } from '../../src/ports/spawner.js';
import type { StepRequest } from '../../src/worker-runtime/types.js';
import { createFakeDeps } from '../support/fake-deps.js';
import { cleanupTempHomes } from '../support/temp-home.js';
import { runtimeSandbox, stepRequest } from '../support/worker-runtime.js';

afterEach(cleanupTempHomes);

/** Starts one OpenCode step with a fake Spawner and returns the program arguments it was given. */
async function argsOf(overrides: Partial<StepRequest>): Promise<readonly string[]> {
  const sandbox = runtimeSandbox();
  const spawner = createFakeSpawner();
  const runtime = createOpenCodeRuntime({
    spawner,
    processTable: createFakeProcessTable(),
    deps: createFakeDeps({ start: 1000 }),
  });

  await runtime.start(stepRequest(sandbox.worktree, overrides)).result;

  expect(spawner.requests).toHaveLength(1);
  expect(spawner.requests[0]?.command).toBe('opencode');
  return spawner.requests[0]?.args ?? [];
}

describe('OpenCode is never invoked with --auto', () => {
  test('an OpenCode start for a write role does not pass --auto', async () => {
    const withoutResume = await argsOf({ readOnly: false });
    const withResume = await argsOf({ readOnly: false, resumeSessionId: 'ses_example_1' });

    for (const args of [withoutResume, withResume]) {
      expect(args.length).toBeGreaterThan(0);
      expect(args).not.toContain('--auto');
      expect(args.filter((arg) => arg.startsWith('--auto'))).toEqual([]);
    }
    expect(withResume).toContain('ses_example_1');
  });

  test('an OpenCode start for a read-only role, including with a resume session id, does not pass --auto', async () => {
    const withoutResume = await argsOf({ readOnly: true, role: 'reviewer' });
    const withResume = await argsOf({ readOnly: true, role: 'reviewer', resumeSessionId: 'ses_example_2' });

    for (const args of [withoutResume, withResume]) {
      expect(args.length).toBeGreaterThan(0);
      expect(args).not.toContain('--auto');
      expect(args.filter((arg) => arg.startsWith('--auto'))).toEqual([]);
    }
    expect(withResume).toContain('ses_example_2');
  });
});
