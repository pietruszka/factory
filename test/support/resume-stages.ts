// The pipeline shape the resume tests use. No vitest import here: the crash test's child process loads it too.
import type { ResumeStage } from '../../src/resume/resume-run.js';
import type { CostOptions } from '../../src/cost/types.js';
import type { StepSpec } from '../../src/run-state/step-runner.js';

const spec = (stepId: string, role: string): StepSpec => ({
  stepId,
  role,
  model: 'example-model',
  prompt: `Do the ${stepId} step for the example page.`,
  timeoutMs: 60_000,
});

/** Steps `prepare` and `implement` in building, `verify` in verifying, `review` in reviewing. */
export const RESUME_STAGES: readonly ResumeStage[] = [
  { phase: 'building', steps: [spec('prepare', 'implementer'), spec('implement', 'implementer')] },
  { phase: 'verifying', steps: [spec('verify', 'verifier')] },
  { phase: 'reviewing', steps: [spec('review', 'reviewer')] },
];

/** Prices for `example-model`: $2 per 1M input tokens, $8 per 1M output tokens. */
export const RESUME_COST: CostOptions = {
  rateTable: { 'example-model': { inputPer1M: 2, outputPer1M: 8, cacheReadPer1M: null, cacheWritePer1M: null } },
  minutes: 30,
  expectedUsage: [],
};
