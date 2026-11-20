import {
  RawStepInputSchema,
  coerceRawStepInput,
  finalizeStepResult,
  fallbackText,
  statusFromExit,
  type StepResult,
} from './step-result.js';

interface CursorResultPayload {
  type?: unknown;
  result?: unknown;
  is_error?: unknown;
  usage?: unknown;
  session_id?: unknown;
}

function parseCursorPayload(stdout: string): CursorResultPayload | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = JSON.parse(trimmed) as CursorResultPayload;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  if (parsed.type !== 'result') {
    return undefined;
  }
  return parsed;
}

export function parseCursorAgentStepResult(input: unknown): StepResult {
  const parsedRaw = RawStepInputSchema.safeParse(input);
  if (!parsedRaw.success) {
    const raw = coerceRawStepInput(input);
    return finalizeStepResult(
      {
        status: 'malformed',
        text: fallbackText(raw),
        cost: 'cost_missing',
        cliVersion: raw.cliVersion,
      },
      raw,
    );
  }

  const raw = parsedRaw.data;
  const baseStatus = statusFromExit(raw);
  let usage: unknown;
  let text = fallbackText(raw);
  let sessionId: string | undefined;
  let status: StepResult['status'] = baseStatus;

  try {
    const payload = parseCursorPayload(raw.stdout);
    if (payload) {
      if (typeof payload.result === 'string') {
        text = payload.result;
      }
      usage = payload.usage;
      if (typeof payload.session_id === 'string') {
        sessionId = payload.session_id;
      }
      if (payload.is_error === true && status === 'ok') {
        status = 'exit_nonzero';
      }
    } else if (status === 'ok') {
      status = 'malformed';
    }
  } catch {
    if (status === 'ok') {
      status = 'malformed';
    }
  }

  return finalizeStepResult(
    {
      status,
      text,
      usage,
      cost: 'cost_missing',
      sessionId,
      cliVersion: raw.cliVersion,
    },
    raw,
  );
}
