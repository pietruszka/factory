// The test-only harness for the runbook's stop limits (D-18). It is not a user-facing command. It wraps one
// agent session: every factory command goes through `run`, and the clock is the injected `Deps`, so no test waits
// for 10 or 60 real minutes.
import type { Deps } from '../../src/platform/deps.js';

/** What identifies a failure: the run status, the exit reason and the step. Three equal ones end the session. */
export interface FailureSignature {
  status: string;
  exitReason: string;
  step: string;
}

/** What one factory command did, as the harness sees it. */
export interface CommandResult {
  exitCode: number;
  /** Set when the command failed. */
  signature?: FailureSignature;
  /** The error code of a failed command, for example `cli_error`. */
  errorCode?: string;
}

/** Runs one factory command. Resolves when it ends; may never resolve for a hung command. */
export type Executor = (argv: readonly string[]) => Promise<CommandResult>;

export interface StopLimitOptions {
  deps: Deps;
  exec: Executor;
  /** Stops the command (the harness's `factory kill`) when it ran over 10 minutes or the session over 60. */
  kill: (argv: readonly string[]) => Promise<void>;
}

export type StopReason =
  | 'identical_failures'
  | 'command_limit'
  | 'command_timeout'
  | 'session_timeout'
  | 'resume_limit'
  | 'retry_limit';

export type CommandOutcome =
  /** The command ran; its result is passed through. */
  | { kind: 'ran'; result: CommandResult }
  /** The command was not started: a limit was already reached. */
  | { kind: 'refused'; reason: StopReason }
  /** The command was started and stopped by the harness. */
  | { kind: 'stopped'; reason: StopReason }
  /** The session is over. */
  | { kind: 'ended'; reason: StopReason };

export interface RunOptions {
  /** The cause a `resume` answers, for example `budget`. At most one resume per cause. */
  cause?: string;
}

export interface StopLimitSession {
  run: (argv: readonly string[], options?: RunOptions) => Promise<CommandOutcome>;
  /** How many commands were started. */
  commandsStarted: () => number;
  /** The report an ended session leaves: the reason and the repeated signature, if any. */
  report: () => string;
}

const MINUTE = 60_000;
const COMMAND_LIMIT = 20;
const COMMAND_TIMEOUT_MS = 10 * MINUTE;
const SESSION_TIMEOUT_MS = 60 * MINUTE;
const IDENTICAL_FAILURE_LIMIT = 3;
/** One command may run twice when it failed with `cli_error`: the first try and one retry. */
const CLI_ERROR_ATTEMPT_LIMIT = 2;

const signatureKey = ({ status, exitReason, step }: FailureSignature): string => `status=${status} exit_reason=${exitReason} step=${step}`;

/** One agent session under the D-18 stop limits. The only clock it reads is `deps`. */
export function createStopLimitSession({ deps, exec, kill }: StopLimitOptions): StopLimitSession {
  const startedAt = deps.now();
  let started = 0;
  let ended: { reason: StopReason; detail: string } | undefined;
  const failures = new Map<string, number>();
  const cliErrors = new Map<string, number>();
  const resumedCauses = new Set<string>();

  const end = (reason: StopReason, detail: string = reason): CommandOutcome => {
    ended ??= { reason, detail };
    return { kind: 'ended', reason: ended.reason };
  };

  const refusal = (argv: readonly string[], options: RunOptions): StopReason | undefined => {
    if (started >= COMMAND_LIMIT) return 'command_limit';
    if (argv[0] === 'resume' && options.cause !== undefined && resumedCauses.has(options.cause)) return 'resume_limit';
    if ((cliErrors.get(argv.join(' ')) ?? 0) >= CLI_ERROR_ATTEMPT_LIMIT) return 'retry_limit';
    return undefined;
  };

  /** Starts the command and races it against its own 10 minute timer and the end of the 60 minute session. */
  const start = (argv: readonly string[], options: RunOptions): Promise<CommandOutcome> => {
    started += 1;
    if (argv[0] === 'resume' && options.cause !== undefined) resumedCauses.add(options.cause);

    return new Promise<CommandOutcome>((resolve, reject) => {
      let settled = false;
      const timers: unknown[] = [];
      /** The first of: the command ends, a timer fires. Later ones are ignored. */
      const settleOnce = (finish: () => void): void => {
        if (settled) return;
        settled = true;
        for (const timer of timers) deps.clearTimer(timer);
        finish();
      };
      const stopWith = (outcome: () => CommandOutcome): void =>
        settleOnce(() => void kill(argv).then(() => resolve(outcome()), reject));

      // Both timers are registered before anything is awaited.
      timers.push(deps.setTimer(() => stopWith(() => ({ kind: 'stopped', reason: 'command_timeout' })), COMMAND_TIMEOUT_MS));
      const sessionLeft = Math.max(0, startedAt + SESSION_TIMEOUT_MS - deps.now());
      timers.push(deps.setTimer(() => stopWith(() => end('session_timeout')), sessionLeft));

      exec(argv).then(
        (result) => settleOnce(() => resolve(afterCommand(argv, result))),
        (error: unknown) => settleOnce(() => reject(error)),
      );
    });
  };

  const afterCommand = (argv: readonly string[], result: CommandResult): CommandOutcome => {
    if (result.errorCode === 'cli_error') {
      const key = argv.join(' ');
      cliErrors.set(key, (cliErrors.get(key) ?? 0) + 1);
    }
    if (result.signature !== undefined) {
      const key = signatureKey(result.signature);
      const count = (failures.get(key) ?? 0) + 1;
      failures.set(key, count);
      if (count >= IDENTICAL_FAILURE_LIMIT) {
        return end('identical_failures', `${count} identical failures (${key})`);
      }
    }
    return { kind: 'ran', result };
  };

  return {
    run: async (argv, options = {}) => {
      if (ended !== undefined) return { kind: 'ended', reason: ended.reason };
      if (deps.now() - startedAt > SESSION_TIMEOUT_MS) return end('session_timeout');
      const reason = refusal(argv, options);
      if (reason !== undefined) return { kind: 'refused', reason };
      return start(argv, options);
    },
    commandsStarted: () => started,
    report: () =>
      ended === undefined
        ? `Session running: ${started} command(s) started.`
        : `Session ended: ${ended.detail}. ${started} command(s) started.`,
  };
}
