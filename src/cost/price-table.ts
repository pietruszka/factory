export interface ModelPrice {
  inputPer1M: number | null;
  outputPer1M: number | null;
  cacheReadPer1M: number | null;
  cacheWritePer1M: number | null;
  sourceUrl: string;
  sourceDate: string;
  sourceNote: string;
}

export interface NormalizedUsageTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type CostEstimate =
  | {
      kind: 'estimated';
      estimated: true;
      model: string;
      usd: number;
      missingPrices: [];
    }
  | {
      kind: 'unknown';
      model: string;
      missingPrices?: Array<'inputPer1M' | 'outputPer1M' | 'cacheReadPer1M' | 'cacheWritePer1M'>;
    };

// Sources captured from Cursor public docs with curl on 2026-11-21.
export const PRICE_TABLE: Record<string, ModelPrice> = {
  'gpt-5.3-codex-high': {
    inputPer1M: null,
    outputPer1M: null,
    cacheReadPer1M: null,
    cacheWritePer1M: null,
    sourceUrl: 'https://cursor.com/docs/models',
    sourceDate: '2026-11-21',
    sourceNote: 'Model ID not listed by this exact name in the published pricing table.',
  },
  'claude-opus-5-5-high': {
    inputPer1M: 4,
    outputPer1M: 20,
    cacheReadPer1M: 0.2,
    cacheWritePer1M: 5,
    sourceUrl: 'https://cursor.com/docs/models',
    sourceDate: '2026-11-21',
    sourceNote: 'Mapped from the table row named "Claude Opus 5.5".',
  },
};

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function normalizeUsageTokens(usage: unknown): NormalizedUsageTokens | null {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    return null;
  }

  const record = usage as Record<string, unknown>;
  const cache = record.cache && typeof record.cache === 'object' ? (record.cache as Record<string, unknown>) : {};

  const inputTokensValue = toFiniteNumber(record.inputTokens) ?? toFiniteNumber(record.input);
  const outputTokensValue = toFiniteNumber(record.outputTokens) ?? toFiniteNumber(record.output);
  const reasoningTokensValue = toFiniteNumber(record.reasoningTokens) ?? toFiniteNumber(record.reasoning);
  const cacheReadTokensValue =
    toFiniteNumber(record.cacheReadTokens) ?? toFiniteNumber(cache.read) ?? toFiniteNumber(cache.input);
  const cacheWriteTokensValue =
    toFiniteNumber(record.cacheWriteTokens) ?? toFiniteNumber(cache.write) ?? toFiniteNumber(cache.output);

  const hasKnownTokenField =
    inputTokensValue !== undefined ||
    outputTokensValue !== undefined ||
    reasoningTokensValue !== undefined ||
    cacheReadTokensValue !== undefined ||
    cacheWriteTokensValue !== undefined;
  if (!hasKnownTokenField) {
    return null;
  }

  const inputTokens = inputTokensValue ?? 0;
  const outputTokens = (outputTokensValue ?? 0) + (reasoningTokensValue ?? 0);
  const cacheReadTokens = cacheReadTokensValue ?? 0;
  const cacheWriteTokens = cacheWriteTokensValue ?? 0;

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  };
}

function needsKnownRate(tokens: number, rate: number | null): boolean {
  return tokens > 0 && rate === null;
}

function usdFromTokens(tokens: number, per1M: number): number {
  return (tokens / 1_000_000) * per1M;
}

export function estimateCost(usage: unknown, model: string): CostEstimate {
  const pricing = PRICE_TABLE[model];
  if (!pricing) {
    return { kind: 'unknown', model };
  }

  const tokens = normalizeUsageTokens(usage);
  if (!tokens) {
    return { kind: 'unknown', model };
  }

  const missingPrices: Array<'inputPer1M' | 'outputPer1M' | 'cacheReadPer1M' | 'cacheWritePer1M'> = [];
  if (needsKnownRate(tokens.inputTokens, pricing.inputPer1M)) {
    missingPrices.push('inputPer1M');
  }
  if (needsKnownRate(tokens.outputTokens, pricing.outputPer1M)) {
    missingPrices.push('outputPer1M');
  }
  if (needsKnownRate(tokens.cacheReadTokens, pricing.cacheReadPer1M)) {
    missingPrices.push('cacheReadPer1M');
  }
  if (needsKnownRate(tokens.cacheWriteTokens, pricing.cacheWritePer1M)) {
    missingPrices.push('cacheWritePer1M');
  }
  if (missingPrices.length > 0) {
    return { kind: 'unknown', model, missingPrices };
  }

  const inputCost = pricing.inputPer1M ? usdFromTokens(tokens.inputTokens, pricing.inputPer1M) : 0;
  const outputCost = pricing.outputPer1M ? usdFromTokens(tokens.outputTokens, pricing.outputPer1M) : 0;
  const cacheReadCost = pricing.cacheReadPer1M ? usdFromTokens(tokens.cacheReadTokens, pricing.cacheReadPer1M) : 0;
  const cacheWriteCost = pricing.cacheWritePer1M
    ? usdFromTokens(tokens.cacheWriteTokens, pricing.cacheWritePer1M)
    : 0;

  return {
    kind: 'estimated',
    estimated: true,
    model,
    usd: inputCost + outputCost + cacheReadCost + cacheWriteCost,
    missingPrices: [],
  };
}
