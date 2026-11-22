import type { Config } from '../config/schema.js';

/** A usage field a runtime is expected to report: `tokens` (any token count) or `cost` (a numeric dollar figure). */
export type UsageField = 'tokens' | 'cost';

/** Where a recorded cost came from: the CLI itself, or priced from reported tokens with the config `rate_table`. */
export type UsageSource = 'reported' | 'estimated';

/** What the step runner needs to enforce the caps of one run. */
export interface CostOptions {
  /** The merged config `rate_table`, keyed by model id. */
  rateTable: Config['rate_table'];
  /** The flow's wall-clock cap in minutes (`config.caps[flow].minutes`). */
  minutes: number;
  /** The usage fields the step's runtime must report. */
  expectedUsage: readonly UsageField[];
}

/** The caps of one flow: dollars and minutes. */
export interface FlowCaps {
  usd: number;
  minutes: number;
}
