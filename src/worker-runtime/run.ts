import type { StepRequest, StepResult, WorkerRuntime } from './types.js';

/** `runtime.start(request).result`. */
export function run(runtime: WorkerRuntime, request: StepRequest): Promise<StepResult> {
  return runtime.start(request).result;
}
