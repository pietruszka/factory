import type { Config } from '../config/schema.js';
import { FactoryError } from '../platform/errors.js';
import type { RunStateContext } from '../run-state/context.js';
import { formatUsd } from './format.js';
import type { FlowCaps } from './types.js';

export interface CheckCapsOptions extends Pick<RunStateContext, 'deps' | 'reader'> {
  runId: string;
  /** The flow's wall-clock cap in minutes. */
  minutes: number;
}

export type CapVerdict =
  | { kind: 'within'; spentUsd: number; elapsedMs: number }
  | { kind: 'budget'; spentUsd: number; capUsd: number; elapsedMs: number; next: string }
  | { kind: 'timeout'; spentUsd: number; capMinutes: number; elapsedMs: number; next: string };

export const MINUTE_MS = 60_000;

/** The dollar and minute caps of a flow from the merged config. An unknown flow is `unknown_flow`. */
export function flowCaps(caps: Config['caps'], flow: string): FlowCaps {
  const found = Object.hasOwn(caps, flow) ? caps[flow as keyof Config['caps']] : undefined;
  if (found === undefined) {
    throw new FactoryError({
      code: 'unknown_flow',
      message: `Flow ${flow} has no caps in the config.`,
      where: `caps.${flow}`,
      next: `Use one of the flows with caps: ${Object.keys(caps).join(', ')}.`,
      exitCode: 2,
    });
  }
  return { usd: found.usd, minutes: found.minutes };
}

function budgetNext(ticket: string, spentUsd: number, capUsd: number): string {
  return `The run spent ${formatUsd(spentUsd)} and reached its ${formatUsd(capUsd)} cap. The worktree is kept. To continue, raise the cap explicitly: factory resume ${ticket} --cap +$2.`;
}

function timeoutNext(ticket: string, elapsedMs: number, capMinutes: number): string {
  return `The run used ${Math.floor(elapsedMs / MINUTE_MS)} min and reached its ${capMinutes} min wall-clock cap. The worktree is kept. To continue, raise the cap explicitly: factory resume ${ticket} --cap +$2.`;
}

/** The dollars spent by every attempt of the run: the sum of the events that carry a `cost_usd`. */
export function spentUsdOf(reader: RunStateContext['reader'], runId: string): number {
  return Number(
    reader.query('SELECT SUM(cost_usd) AS total FROM events WHERE run_id = ? AND cost_usd IS NOT NULL', runId)[0]?.total ?? 0,
  );
}

/**
 * Sums the cost of every attempt of the run (events with a `cost_usd`; an event without one adds nothing) and
 * the wall-clock since `runs.started_at`, and compares them with `runs.cap_usd_effective` and `minutes`.
 * Reaching a cap counts. A run without `cap_usd_effective` has no dollar cap.
 */
export function checkCaps({ deps, reader, runId, minutes }: CheckCapsOptions): CapVerdict {
  const run = reader.query('SELECT ticket, started_at, cap_usd_effective FROM runs WHERE run_id = ?', runId)[0];
  if (run === undefined) {
    throw new FactoryError({
      code: 'run_not_found',
      message: `There is no run ${runId} in the event log.`,
      where: runId,
      next: 'Pass the run_id of a run that was recorded in the event log.',
      exitCode: 2,
    });
  }
  const ticket = String(run.ticket);
  const spentUsd = spentUsdOf(reader, runId);
  const elapsedMs = deps.now() - Date.parse(String(run.started_at));
  const capUsd = typeof run.cap_usd_effective === 'number' ? run.cap_usd_effective : undefined;
  if (capUsd !== undefined && spentUsd >= capUsd) {
    return { kind: 'budget', spentUsd, capUsd, elapsedMs, next: budgetNext(ticket, spentUsd, capUsd) };
  }
  if (elapsedMs >= minutes * MINUTE_MS) {
    return { kind: 'timeout', spentUsd, capMinutes: minutes, elapsedMs, next: timeoutNext(ticket, elapsedMs, minutes) };
  }
  return { kind: 'within', spentUsd, elapsedMs };
}
