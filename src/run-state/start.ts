import { flowCaps } from '../cost/caps.js';
import type { Config } from '../config/schema.js';
import type { RunInput } from '../event-log/open.js';
import type { RunStateContext } from './context.js';

export interface StartRunOptions {
  /** The merged config caps. The run's `cap_usd_effective` is taken from the flow's `usd` unless the input sets one. */
  caps?: Config['caps'];
}

/**
 * Starts a run in `preflight`. A second run for the same repo and ticket is refused as
 * `run_already_active` by the one-active-run index while the first one is not passed, refused or breach.
 */
export function startRun(
  context: RunStateContext,
  input: Omit<RunInput, 'status'>,
  options: StartRunOptions = {},
): { run_id: string } {
  const cap = input.cap_usd_effective ?? (options.caps === undefined ? undefined : flowCaps(options.caps, input.flow).usd);
  return context.log.insertRun({ ...input, ...(cap === undefined ? {} : { cap_usd_effective: cap }), status: 'preflight' });
}
