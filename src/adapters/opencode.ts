import {
  RawStepInputSchema,
  coerceRawStepInput,
  finalizeStepResult,
  fallbackText,
  statusFromExit,
  type StepResult,
} from './step-result.js';

interface OpenCodeEvent {
  type?: unknown;
  sessionID?: unknown;
  part?: {
    text?: unknown;
    tokens?: unknown;
    cost?: unknown;
    sessionID?: unknown;
  };
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function parseOpenCodeStepResult(input: unknown): StepResult {
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
  let status: StepResult['status'] = baseStatus;
  let usage: unknown;
  let text = '';
  let sessionId: string | undefined;
  let cost: number | 'cost_missing' = 'cost_missing';
  let sawStepFinish = false;
  let totalCost = 0;
  let hasCost = false;

  const lines = raw.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  try {
    for (const line of lines) {
      const event = JSON.parse(line) as OpenCodeEvent;
      if (!event || typeof event !== 'object') {
        continue;
      }

      if (typeof event.sessionID === 'string') {
        sessionId = event.sessionID;
      }

      if (!event.part || typeof event.part !== 'object') {
        continue;
      }

      if (typeof event.part.sessionID === 'string') {
        sessionId = event.part.sessionID;
      }
      if (event.type === 'text' && typeof event.part.text === 'string') {
        text += event.part.text;
      }
      if (event.type === 'step_finish') {
        sawStepFinish = true;
        if (event.part.tokens !== undefined) {
          usage = event.part.tokens;
        }
        const parsedCost = toFiniteNumber(event.part.cost);
        if (parsedCost !== undefined) {
          totalCost += parsedCost;
          hasCost = true;
        }
      }
    }
  } catch {
    if (status === 'ok') {
      status = 'malformed';
    }
  }

  if (status === 'ok' && !sawStepFinish) {
    status = 'malformed';
  }

  if (!text) {
    text = raw.stderr.trim();
  }

  if (hasCost) {
    cost = totalCost;
  }

  return finalizeStepResult(
    {
      status,
      text,
      usage,
      cost,
      sessionId,
      cliVersion: raw.cliVersion,
    },
    raw,
  );
}
