import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { createCursorAgentRuntime } from '../../src/adapters/cursor-agent.js';
import { createOpenCodeRuntime } from '../../src/adapters/opencode.js';
import { createFakeProcessTable } from '../../src/ports/process-table.js';
import { createFakeSpawner } from '../../src/ports/spawner.js';
import { getWorkerRuntime } from '../../src/worker-runtime/registry.js';
import { run } from '../../src/worker-runtime/run.js';
import type { RuntimeId, WorkerRuntime } from '../../src/worker-runtime/types.js';
import { createFakeDeps } from '../support/fake-deps.js';
import { errorFields, thrownBy } from '../support/event-log.js';
import { createTestAdapterRuntime } from '../support/test-adapter.js';
import { cleanupTempHomes } from '../support/temp-home.js';
import { runtimeSandbox, stepRequest } from '../support/worker-runtime.js';

afterEach(cleanupTempHomes);

const repoRoot = join(import.meta.dirname, '..', '..');

function registryWithThirdAdapter(): ReadonlyMap<RuntimeId, WorkerRuntime> {
  const options = { spawner: createFakeSpawner(), processTable: createFakeProcessTable(), deps: createFakeDeps() };
  const runtimes = [createCursorAgentRuntime(options), createOpenCodeRuntime(options), createTestAdapterRuntime()];
  return new Map(runtimes.map((runtime) => [runtime.id, runtime]));
}

describe('a new adapter is added without changing pipeline code', () => {
  test('a third test adapter is selected by id from a caller-supplied registry and runs, with no change to the lookup helper or other pipeline modules', async () => {
    const sandbox = runtimeSandbox();
    const registry = registryWithThirdAdapter();

    const runtime = getWorkerRuntime(registry, 'test-adapter');
    const result = await run(runtime, stepRequest(sandbox.worktree));

    expect(runtime.id).toBe('test-adapter');
    expect(result.rawText).toBe('test adapter done');
    expect(result.sessionId).toBe('session-test-adapter');
    expect(getWorkerRuntime(registry, 'cursor-agent').id).toBe('cursor-agent');
    expect(getWorkerRuntime(registry, 'opencode').id).toBe('opencode');
    for (const file of ['registry.ts', 'run.ts', 'types.ts']) {
      expect(readFileSync(join(repoRoot, 'src', 'worker-runtime', file), 'utf8')).not.toContain('test-adapter');
    }
  });

  test('looking up an id that is not in the registry is refused as unknown_worker_runtime, exit code 2', () => {
    const registry = new Map<RuntimeId, WorkerRuntime>([['test-adapter', createTestAdapterRuntime()]]);

    const error = errorFields(thrownBy(() => getWorkerRuntime(registry, 'fake-worker')));

    expect(error.code).toBe('unknown_worker_runtime');
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain('fake-worker');
    expect(error.next).toBeTruthy();
  });
});
