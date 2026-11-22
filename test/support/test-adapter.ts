import type { RunningStep, StepResult, WorkerRuntime } from '../../src/worker-runtime/types.js';

/** A self-contained third adapter (NFR-35). It starts nothing and answers with a fixed result. */
export function createTestAdapterRuntime(): WorkerRuntime {
  const result: StepResult = {
    exitReason: 'ok',
    rawText: 'test adapter done',
    sessionId: 'session-test-adapter',
    durationMs: 0,
    processes: [],
  };
  return {
    id: 'test-adapter',
    capabilities: () => ({ resume: false, readOnly: true, structuredOutput: false }),
    detectVersion: async () => 'test-adapter 0.0.0',
    start: (): RunningStep => ({
      events: (async function* () {})(),
      result: Promise.resolve(result),
      kill: async () => undefined,
    }),
  };
}
