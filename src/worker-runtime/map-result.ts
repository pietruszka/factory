import type { StepResult as ParserStepResult } from '../adapters/step-result.js';
import type { StepProcess, StepResult } from './types.js';

/** Maps an L2 parser result into the runtime result. Cost stays with the parser result; the core normaliser comes later. */
export function toRuntimeStepResult(
  parsed: ParserStepResult,
  extra: { durationMs: number; processes: readonly StepProcess[] },
): StepResult {
  return {
    exitReason: parsed.status,
    rawText: parsed.text,
    ...(parsed.status === 'malformed' ? { parseError: 'the CLI output was not a valid result' } : {}),
    ...(parsed.sessionId === undefined ? {} : { sessionId: parsed.sessionId }),
    ...(parsed.usage === undefined ? {} : { usage: parsed.usage }),
    durationMs: extra.durationMs,
    processes: extra.processes,
  };
}
