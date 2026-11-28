import { z } from 'zod';

import { estimateCost } from '../cost/price-table.js';

export const RawStepInputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean().default(false),
  cliVersion: z.string(),
});

export type RawStepInput = z.infer<typeof RawStepInputSchema>;

const StepResultSchema = z.strictObject({
  status: z.enum(['ok', 'malformed', 'timeout', 'exit_nonzero']),
  text: z.string(),
  usage: z.unknown().optional(),
  cost: z.union([z.number(), z.literal('cost_missing')]),
  estimated: z.literal(true).optional(),
  sessionId: z.string().optional(),
  cliVersion: z.string(),
  raw: RawStepInputSchema,
});

export type StepResult = z.infer<typeof StepResultSchema>;
export type StepResultStatus = StepResult['status'];

function coerceString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function coerceExitCode(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function coerceTimedOut(value: unknown): boolean {
  return value === true;
}

export function coerceRawStepInput(input: unknown): RawStepInput {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const raw = input as Record<string, unknown>;
    return {
      stdout: coerceString(raw.stdout),
      stderr: coerceString(raw.stderr),
      exitCode: coerceExitCode(raw.exitCode),
      timedOut: coerceTimedOut(raw.timedOut),
      cliVersion: coerceString(raw.cliVersion),
    };
  }

  return {
    stdout: '',
    stderr: '',
    exitCode: null,
    timedOut: false,
    cliVersion: '',
  };
}

export function fallbackText(raw: RawStepInput): string {
  const output = `${raw.stdout}\n${raw.stderr}`.trim();
  return output;
}

export function statusFromExit(raw: RawStepInput): StepResultStatus {
  if (raw.timedOut) {
    return 'timeout';
  }
  return raw.exitCode !== 0 ? 'exit_nonzero' : 'ok';
}

interface FinalizeCandidate {
  status: StepResultStatus;
  text: string;
  usage?: unknown;
  cost: number | 'cost_missing';
  estimated?: true;
  sessionId?: string;
  cliVersion: string;
}

export function withEstimatedCost(candidate: FinalizeCandidate, modelId?: string): FinalizeCandidate {
  if (!modelId || candidate.cost !== 'cost_missing' || candidate.usage === undefined) {
    return candidate;
  }
  const estimate = estimateCost(candidate.usage, modelId);
  if (estimate.kind !== 'estimated') {
    return candidate;
  }

  return {
    ...candidate,
    cost: estimate.usd,
    estimated: true,
  };
}

export function finalizeStepResult(candidate: FinalizeCandidate, raw: RawStepInput): StepResult {
  const validated = StepResultSchema.safeParse({
    ...candidate,
    raw,
  });
  if (validated.success) {
    return validated.data;
  }

  return {
    status: 'malformed',
    text: fallbackText(raw),
    cost: 'cost_missing',
    cliVersion: raw.cliVersion,
    raw,
  };
}
