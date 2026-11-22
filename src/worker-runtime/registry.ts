import { FactoryError } from '../platform/errors.js';
import type { RuntimeId, WorkerRuntime, WorkerRuntimeRegistry } from './types.js';

/** Looks a runtime up by id in the registry the caller passes in. */
export function getWorkerRuntime(registry: WorkerRuntimeRegistry, id: RuntimeId): WorkerRuntime {
  const runtime = registry.get(id);
  if (runtime === undefined) {
    throw new FactoryError({
      code: 'unknown_worker_runtime',
      message: `No worker runtime is registered as ${id}.`,
      where: id,
      next: `use one of: ${[...registry.keys()].join(', ') || 'none are registered'}`,
      exitCode: 2,
    });
  }
  return runtime;
}
