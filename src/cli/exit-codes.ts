/** Process exit codes from the agent runbook (P-23). */
export interface ExitCodes {
  /** Done. */
  ok: number;
  /** Stopped and needs attention (first used in a later ticket). */
  needsAttention: number;
  /** Refused, or the command was used wrongly. */
  refused: number;
  /** A safety limit was breached (first used in a later ticket). */
  breach: number;
  /** Internal error: a bug in the factory. */
  internal: number;
}

export const EXIT_CODES: ExitCodes = {
  ok: 0,
  needsAttention: 1,
  refused: 2,
  breach: 3,
  internal: 4,
};
