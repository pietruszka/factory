import type { StepResult } from '../worker-runtime/types.js';
import { estimateCost, normalizeUsageTokens } from './price-table.js';
import type { CostOptions, UsageField, UsageSource } from './types.js';

export interface NormaliseUsageOptions {
  result: Pick<StepResult, 'usage' | 'costUsd'>;
  model: string;
  rateTable: CostOptions['rateTable'];
  expectedUsage: readonly UsageField[];
}

export type UsageOutcome =
  /** A dollar figure was produced and is flagged `reported` or `estimated`. A reported `0` is a figure. */
  | { kind: 'priced'; costUsd: number; usageSource: UsageSource }
  /** Nothing was expected and nothing was reported: no dollar figure is invented. */
  | { kind: 'unpriced' }
  /** An expected field is absent, or tokens cannot be priced. The step must end as `cost_missing`. */
  | { kind: 'missing'; fields: readonly string[] };

/**
 * Turns the usage of a finished step into a flagged dollar figure, or `missing`. An expected field that is
 * absent is missing. A numeric reported cost (including 0) is `reported`. Otherwise reported tokens are priced
 * with the config `rate_table` and are `estimated`; tokens that cannot be priced are missing, never a zero.
 */
export function normaliseUsage({ result, model, rateTable, expectedUsage }: NormaliseUsageOptions): UsageOutcome {
  const tokens = normalizeUsageTokens(result.usage);
  const reported = typeof result.costUsd === 'number' && Number.isFinite(result.costUsd) ? result.costUsd : undefined;
  const absent = expectedUsage.filter((field) => (field === 'tokens' ? tokens === null : reported === undefined));
  if (absent.length > 0) {
    return { kind: 'missing', fields: absent };
  }
  if (reported !== undefined) {
    return { kind: 'priced', costUsd: reported, usageSource: 'reported' };
  }
  if (tokens === null) {
    return { kind: 'unpriced' };
  }
  const estimate = estimateCost(result.usage, model, rateTable);
  return estimate.kind === 'estimated'
    ? { kind: 'priced', costUsd: estimate.usd, usageSource: 'estimated' }
    : { kind: 'missing', fields: estimate.missingPrices ?? [`rate_table.${model}`] };
}
