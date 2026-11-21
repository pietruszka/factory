import {
  RawStepInputSchema,
  coerceRawStepInput,
  finalizeStepResult,
  fallbackText,
  statusFromExit,
  withEstimatedCost,
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

interface OpenCodeTokenTotals {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  hasAny: boolean;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readStepTokens(tokens: unknown): OpenCodeTokenTotals {
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) {
    return {
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      hasAny: false,
    };
  }

  const tokenRecord = tokens as Record<string, unknown>;
  const cache =
    tokenRecord.cache && typeof tokenRecord.cache === 'object' ? (tokenRecord.cache as Record<string, unknown>) : {};

  const inputValue = toFiniteNumber(tokenRecord.input);
  const outputValue = toFiniteNumber(tokenRecord.output);
  const reasoningValue = toFiniteNumber(tokenRecord.reasoning);
  const cacheReadValue = toFiniteNumber(cache.read);
  const cacheWriteValue = toFiniteNumber(cache.write);

  const input = inputValue ?? 0;
  const output = outputValue ?? 0;
  const reasoning = reasoningValue ?? 0;
  const cacheRead = cacheReadValue ?? 0;
  const cacheWrite = cacheWriteValue ?? 0;

  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    hasAny:
      inputValue !== undefined ||
      outputValue !== undefined ||
      reasoningValue !== undefined ||
      cacheReadValue !== undefined ||
      cacheWriteValue !== undefined,
  };
}

export function parseOpenCodeStepResult(input: unknown, modelId?: string): StepResult {
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
  // Text is tracked per step: multi-step runs (e.g. cursor-acp/ tool calls) emit tool-call JSON as
  // text in earlier steps, so the result text is the last step that produced any text.
  let text = '';
  let stepText = '';
  let sessionId: string | undefined;
  let cost: number | 'cost_missing' = 'cost_missing';
  let sawStepFinish = false;
  let totalCost = 0;
  let hasCost = false;
  const usageTotals: OpenCodeTokenTotals = {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    hasAny: false,
  };

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
      if (event.type === 'step_start') {
        stepText = '';
      }
      if (event.type === 'text' && typeof event.part.text === 'string') {
        stepText += event.part.text;
        text = stepText;
      }
      if (event.type === 'step_finish') {
        sawStepFinish = true;
        if (event.part.tokens !== undefined) {
          const stepTokens = readStepTokens(event.part.tokens);
          usageTotals.input += stepTokens.input;
          usageTotals.output += stepTokens.output;
          usageTotals.reasoning += stepTokens.reasoning;
          usageTotals.cacheRead += stepTokens.cacheRead;
          usageTotals.cacheWrite += stepTokens.cacheWrite;
          usageTotals.hasAny = usageTotals.hasAny || stepTokens.hasAny;
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
  if (usageTotals.hasAny) {
    usage = {
      input: usageTotals.input,
      output: usageTotals.output,
      reasoning: usageTotals.reasoning,
      cache: {
        read: usageTotals.cacheRead,
        write: usageTotals.cacheWrite,
      },
    };
  }

  return finalizeStepResult(
    withEstimatedCost(
      {
        status,
        text,
        usage,
        cost,
        sessionId,
        cliVersion: raw.cliVersion,
      },
      modelId,
    ),
    raw,
  );
}
