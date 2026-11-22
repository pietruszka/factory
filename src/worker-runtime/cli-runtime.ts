import type { StepResult as ParserStepResult } from '../adapters/step-result.js';
import { toRuntimeStepResult } from './map-result.js';
import { startStep } from './start-step.js';
import type { AdapterRuntimeOptions, RuntimeCapabilities, RuntimeId, StepRequest, WorkerRuntime } from './types.js';

export interface CliRuntimeSpec {
  id: RuntimeId;
  /** Program name, started through the Spawner. */
  command: string;
  capabilities: RuntimeCapabilities;
  buildArgs: (request: StepRequest) => string[];
  /** The existing L2 parser for this CLI's output. */
  parse: (raw: unknown) => ParserStepResult;
}

/** A WorkerRuntime for a model CLI: starts it through the Spawner and maps its output with the L2 parser. */
export function createCliRuntime(spec: CliRuntimeSpec, options: AdapterRuntimeOptions): WorkerRuntime {
  const { spawner, deps, eventLog } = options;
  return {
    id: spec.id,
    capabilities: () => spec.capabilities,
    detectVersion: async () => {
      const child = await spawner.spawn({ command: spec.command, args: ['--version'] });
      const { stdout, stderr } = (await child.output) ?? { stdout: '', stderr: '' };
      const line = `${stdout}\n${stderr}`.split('\n').find((each) => each.trim() !== '');
      return line?.trim() ?? 'unknown';
    },
    start: (request) =>
      startStep({
        spawner,
        deps,
        eventLog,
        request,
        command: spec.command,
        args: spec.buildArgs(request),
        toResult: (output) =>
          toRuntimeStepResult(
            spec.parse({
              stdout: output.stdout,
              stderr: output.stderr,
              exitCode: output.code,
              timedOut: output.timedOut,
              cliVersion: '',
            }),
            { durationMs: output.durationMs, processes: output.processes },
          ),
      }),
  };
}
