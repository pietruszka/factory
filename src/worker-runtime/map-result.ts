import type { StepResult as ParserStepResult } from '../adapters/step-result.js';
import type { StepProcess, StepResult } from './types.js';

/** Maps an L2 parser result into the runtime result. A numeric cost the CLI reported becomes `costUsd`; a cost the parser estimated itself is dropped, so the core normaliser prices tokens from the config `rate_table`. */
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
    ...(typeof parsed.cost === 'number' && parsed.estimated !== true ? { costUsd: parsed.cost } : {}),
    durationMs: extra.durationMs,
    processes: extra.processes,
  };
}
