import type { RunStateContext } from './context.js';
import { transition } from './transition.js';

export type LoopKind = 'fix' | 'verify_fail' | 'revision';

export interface LoopDecision {
  allowed: boolean;
  /** How many loops of this kind the run has entered, this one included. */
  count: number;
}

/** Loops allowed per kind before the run goes to a human. */
const MAX_LOOPS = 2;

const EVENT_TYPE = 'loop';

/**
 * Counts a fix, verify-fail or revision loop. The first two of a kind are allowed and recorded as events.
 * The third is refused: it is not recorded, and the run moves to `needs_human`.
 */
export function enterLoop(context: RunStateContext, runId: string, kind: LoopKind): LoopDecision {
  const entered = Number(
    context.reader.query(
      "SELECT COUNT(*) AS n FROM events WHERE run_id = ? AND type = ? AND json_extract(payload_json, '$.kind') = ?",
      runId,
      EVENT_TYPE,
      kind,
    )[0]?.n ?? 0,
  );
  const count = entered + 1;
  if (count > MAX_LOOPS) {
    transition(context, runId, 'needs_human');
    return { allowed: false, count };
  }
  context.log.appendEvent({ run_id: runId, type: EVENT_TYPE, payload: { kind } });
  return { allowed: true, count };
}
