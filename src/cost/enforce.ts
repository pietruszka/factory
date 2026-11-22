import type { RunStateContext, RunStatus } from '../run-state/context.js';
import type { StepResult } from '../worker-runtime/types.js';
import { checkCaps, MINUTE_MS } from './caps.js';
import { normaliseUsage } from './usage.js';
import type { CostOptions } from './types.js';

const STOP_EVENT = 'run_stop';

export interface UsageStep {
  runId: string;
  stepId: string;
  attempt: number;
  role: string;
  model: string;
}

/** Writes why a run stopped and what to do next. The run report prints `next` under `## Next action`. */
function recordStop(context: RunStateContext, runId: string, status: RunStatus, payload: { next: string } & Record<string, unknown>): void {
  context.log.appendEvent({ run_id: runId, type: STOP_EVENT, status, payload });
}

/**
 * Normalises the usage of a finished attempt and writes a `usage` event when a dollar figure was produced
 * (never one for an absence). Returns true when an expected field of a successful step is missing: the step
 * must then end as `cost_missing`, and the reason and next action are recorded.
 */
export function recordUsage(
  context: RunStateContext,
  cost: CostOptions,
  step: UsageStep,
  result: Pick<StepResult, 'usage' | 'costUsd'> & { exitReason: string },
): boolean {
  const outcome = normaliseUsage({ result, model: step.model, rateTable: cost.rateTable, expectedUsage: cost.expectedUsage });
  if (outcome.kind === 'priced') {
    context.log.appendEvent({
      run_id: step.runId,
      type: 'usage',
      step: step.stepId,
      attempt: step.attempt,
      role: step.role,
      model: step.model,
      cost_usd: outcome.costUsd,
      usage_source: outcome.usageSource,
    });
  }
  if (outcome.kind !== 'missing' || result.exitReason !== 'ok') {
    return false;
  }
  const fields = outcome.fields.join(', ');
  recordStop(context, step.runId, 'cost_missing', {
    fields: outcome.fields,
    next: `Step ${step.stepId} did not report: ${fields}. Nothing was counted as zero. Fix the usage the CLI reports or the rate_table entry for ${step.model}, then resume the run.`,
  });
  return true;
}

/**
 * Checks the run's caps. A reached cap is recorded with its next action and returned as the stop status.
 * With `explains`, a cap is only recorded when it is the one that matches an already known stop.
 */
export function enforceCaps(
  context: RunStateContext,
  runId: string,
  cost: CostOptions,
  explains?: RunStatus,
): 'budget' | 'timeout' | undefined {
  const verdict = checkCaps({ ...context, runId, minutes: cost.minutes });
  if (verdict.kind === 'within' || (explains !== undefined && explains !== verdict.kind)) {
    return undefined;
  }
  recordStop(context, runId, verdict.kind, { spentUsd: verdict.spentUsd, elapsedMs: verdict.elapsedMs, next: verdict.next });
  return verdict.kind;
}

/** The wall-clock left in the run, never below 1 ms. */
export function remainingMs(context: RunStateContext, runId: string, cost: CostOptions): number {
  const { elapsedMs } = checkCaps({ ...context, runId, minutes: cost.minutes });
  return Math.max(cost.minutes * MINUTE_MS - elapsedMs, 1);
}
