import type { RunInput } from '../event-log/open.js';
import type { RunStateContext } from './context.js';

/**
 * Starts a run in `preflight`. A second run for the same repo and ticket is refused as
 * `run_already_active` by the one-active-run index while the first one is not passed, refused or breach.
 */
export function startRun(context: RunStateContext, input: Omit<RunInput, 'status'>): { run_id: string } {
  return context.log.insertRun({ ...input, status: 'preflight' });
}
