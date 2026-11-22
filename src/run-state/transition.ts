import { NON_RESUMABLE_RUN_STATUSES } from '../event-log/schema.js';
import { FactoryError } from '../platform/errors.js';
import { runFolderPath } from '../run-folder/path.js';
import { canPassFromReport } from '../run-folder/report.js';
import { isoNow, readRun, type RunStateContext, type RunStatus } from './context.js';

/** The phases in happy-path order. A run that finishes the last one is `passed`. */
export const PHASES = [
  'preflight',
  'routing',
  'planning',
  'awaiting_approval',
  'building',
  'gating',
  'verifying',
  'reviewing',
  'opening_pr',
] as const satisfies readonly RunStatus[];

/** Statuses a run can stop in from any phase. */
export const STOP_STATUSES = [
  'refused',
  'config_drift',
  'needs_human',
  'cannot_reproduce',
  'budget',
  'timeout',
  'cost_missing',
  'breach',
  'killed',
  'interrupted',
] as const satisfies readonly RunStatus[];

const EVENT_TYPE = 'run_status';

function isPhase(status: RunStatus): boolean {
  return (PHASES as readonly RunStatus[]).includes(status);
}

function isFinal(status: RunStatus): boolean {
  return (NON_RESUMABLE_RUN_STATUSES as readonly RunStatus[]).includes(status);
}

/** The phase a stopped run left, from the last status event; undefined when the status was not written by `transition`. */
function phaseLeft(context: RunStateContext, runId: string, status: RunStatus): RunStatus | undefined {
  const last = context.reader.query(
    'SELECT status, payload_json FROM events WHERE run_id = ? AND type = ? ORDER BY id DESC LIMIT 1',
    runId,
    EVENT_TYPE,
  )[0];
  if (last?.status !== status || typeof last.payload_json !== 'string') {
    return undefined;
  }
  const from = (JSON.parse(last.payload_json) as { from?: RunStatus }).from;
  return from !== undefined && isPhase(from) ? from : undefined;
}

/** The statuses a run can move to from `from`. A stopped run goes back to the phase it left, or to any phase when that is not known. */
function legalTargets(from: RunStatus, left: RunStatus | undefined): readonly RunStatus[] {
  if (isPhase(from)) {
    const next = PHASES[PHASES.indexOf(from as (typeof PHASES)[number]) + 1] ?? 'passed';
    return [next, ...STOP_STATUSES];
  }
  if (isFinal(from)) {
    return [];
  }
  return left === undefined ? PHASES : [left];
}

function illegal(runId: string, from: RunStatus, to: RunStatus, targets: readonly RunStatus[]): FactoryError {
  return new FactoryError({
    code: 'illegal_transition',
    message: `Run ${runId} cannot move from ${from} to ${to}.`,
    where: `runs.status (${runId})`,
    next:
      targets.length === 0
        ? `A run in ${from} is final. Start a new run for the ticket instead.`
        : `From ${from} a run can move to: ${targets.join(', ')}.`,
    exitCode: 2,
  });
}

function cannotPass(runId: string, runFolder: string): FactoryError {
  return new FactoryError({
    code: 'passed_refused',
    message: `Run ${runId} cannot pass: the report in ${runFolder} does not list every required artifact as present.`,
    where: runFolder,
    next: 'Write the missing artifacts and the report again, then move the run to passed.',
    exitCode: 2,
  });
}

/**
 * Moves a run to `to`. The only production writer of `runs.status`: it refuses an illegal move as
 * `illegal_transition` and leaves the stored status unchanged. `passed` also needs `canPassFromReport`.
 * Moving to the status the run already has changes nothing.
 */
export function transition(context: RunStateContext, runId: string, to: RunStatus): void {
  const run = readRun(context, runId);
  if (run.status === to) {
    return;
  }
  const stoppedAndResumable = !isPhase(run.status) && !isFinal(run.status);
  const targets = legalTargets(run.status, stoppedAndResumable ? phaseLeft(context, runId, run.status) : undefined);
  if (!targets.includes(to)) {
    throw illegal(runId, run.status, to, targets);
  }
  if (to === 'passed') {
    const folder = runFolderPath(context.env, run.repo, run.ticket);
    if (!canPassFromReport(folder)) {
      throw cannotPass(runId, folder);
    }
  }
  context.log.updateRunStatus(runId, to, isPhase(to) ? undefined : isoNow(context));
  context.log.appendEvent({ run_id: runId, type: EVENT_TYPE, status: to, payload: { from: run.status, to } });
}
