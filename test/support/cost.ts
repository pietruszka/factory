import { mkdirSync } from 'node:fs';

import type { CostOptions } from '../../src/cost/types.js';
import type { StepRequest } from '../../src/worker-runtime/types.js';
import type { RunStepsOptions } from '../../src/run-state/step-runner.js';
import { runStateFixture, type InstrumentedRuntime, type RunStateFixture } from './run-state.js';

/** Prices for `example-model`: $2 per 1M input tokens, $8 per 1M output tokens, no cache prices. */
export const EXAMPLE_RATES: CostOptions['rateTable'] = {
  'example-model': { inputPer1M: 2, outputPer1M: 8, cacheReadPer1M: null, cacheWritePer1M: null },
};

export const MINUTE_MS = 60_000;

/** The cost options a test passes to `runSteps`; every field can be overridden. */
export function costOptions(overrides: Partial<CostOptions> = {}): CostOptions {
  return { rateTable: EXAMPLE_RATES, minutes: 30, expectedUsage: ['tokens'], ...overrides };
}

/** Run `run-1` in `building` with an existing worktree folder, a fake worker playing `scenario`, and a cap. */
export function cappedBuilding(
  scenario: string,
  opts: { capUsd?: number; cost?: CostOptions; onStart?: (state: RunStateFixture, request: StepRequest) => void } = {},
): {
  state: RunStateFixture;
  worker: InstrumentedRuntime;
  options: (steps: RunStepsOptions['steps']) => RunStepsOptions;
} {
  const state = runStateFixture({ run: opts.capUsd === undefined ? {} : { cap_usd_effective: opts.capUsd } });
  mkdirSync(state.worktree, { recursive: true });
  state.arrange('building');
  const worker = state.scenarioRuntime(scenario, (request) => opts.onStart?.(state, request));
  const options = (steps: RunStepsOptions['steps']): RunStepsOptions => ({
    ...state.context,
    runtime: worker.runtime,
    runId: 'run-1',
    phase: 'building',
    cwd: state.worktree,
    steps,
    cost: opts.cost ?? costOptions(),
  });
  return { state, worker, options };
}

/** Events of run-1 that carry a dollar figure, oldest first. */
export function costRows(state: RunStateFixture): Array<Record<string, unknown>> {
  return state.rows(
    'SELECT step, attempt, cost_usd, usage_source FROM events WHERE run_id = ? AND cost_usd IS NOT NULL ORDER BY id',
    'run-1',
  );
}

/** The text of the `## Next action` section of a report, or undefined when the report has none. */
export function nextActionSection(report: string): string | undefined {
  const lines = report.split('\n');
  const start = lines.indexOf('## Next action');
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}
