import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveFactoryHome } from '../dev/home.js';
import { runAsMain } from '../dev/run-as-main.js';
import { assertLive, Budget, BudgetExceeded } from '../dev/live-guard.js';
import { PROBE_PROMPT } from './prompt.js';
import { redactProbeValue, buildRedactionValues } from './redact.js';
import {
  buildProbeRunnerSpecs,
  readProbeCliVersion,
  runProbeCli,
  type ProbeCliName,
} from './runners.js';

const TEN_MB = 10 * 1024 * 1024;
const EMAIL_UNRESOLVED_ERROR = 'account email unresolved; cannot redact';
const AGENT_NOT_FOUND_ERROR = 'agent CLI not found';
const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));

export interface RunProbeOptions {
  env?: NodeJS.ProcessEnv;
  repoRoot?: string;
  out?: Pick<NodeJS.WriteStream, 'write'>;
}

export interface ProbeFixture {
  cli: ProbeCliName;
  prompt: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  usage?: unknown;
  cliVersion: string;
  cliVersionSource?: 'version_flag' | 'backfilled';
  cliVersionEvidence?: string;
  /** Cost is unknown when the CLI output did not report any parseable cost field. */
  cost: number | 'unknown';
  /** True when exit is non-zero, signal/error occurs, is_error=true, or budget is exceeded. */
  failed: boolean;
  /** True when the reported cost reaches or exceeds the per-CLI budget cap. */
  budgetExceeded: boolean;
  error?: string;
}

export interface ProbeRunSummary {
  factoryHome: string;
  totalReportedCostUsd: number | 'unknown';
  failed: boolean;
  fixtures: ProbeFixture[];
}

export interface ProbeCostSummary {
  totalReportedCostUsd: number | 'unknown';
  partialUnknownClis: ProbeCliName[];
  costByCli: Record<ProbeCliName, number | 'unknown'>;
  skippedRedactionEnvNames: string[];
}

function parseJsonObjects(output: string): unknown[] {
  const parsed: unknown[] = [];
  const trimmed = output.trim();
  if (!trimmed) {
    return parsed;
  }

  try {
    parsed.push(JSON.parse(trimmed));
  } catch {
    for (const line of trimmed.split('\n')) {
      const normalized = line.trim();
      if (!normalized) {
        continue;
      }
      try {
        parsed.push(JSON.parse(normalized));
      } catch {
        // Ignore non-JSON lines.
      }
    }
  }

  return parsed;
}

function findFirst(
  value: unknown,
  keyPattern: RegExp,
  pick: (entry: unknown) => unknown | undefined,
): unknown | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findFirst(entry, keyPattern, pick);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (keyPattern.test(key)) {
      const picked = pick(entry);
      if (picked !== undefined) {
        return picked;
      }
    }
    const found = findFirst(entry, keyPattern, pick);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function findUsage(value: unknown): unknown | undefined {
  return findFirst(value, /^(usage|tokens)$/i, (entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return undefined;
    }
    return entry;
  });
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function sumCost(value: unknown): { total: number; found: boolean } {
  if (!value || typeof value !== 'object') {
    return { total: 0, found: false };
  }

  if (Array.isArray(value)) {
    let total = 0;
    let found = false;
    for (const entry of value) {
      const summed = sumCost(entry);
      total += summed.total;
      found = found || summed.found;
    }
    return { total, found };
  }

  let total = 0;
  let found = false;
  for (const [key, entry] of Object.entries(value)) {
    if (/^(cost|total_cost_usd|cost_usd)$/i.test(key)) {
      const parsed = toFiniteNumber(entry);
      if (parsed !== undefined) {
        total += parsed;
        found = true;
      }
      // Do not descend into a matched cost key to avoid counting nested details.
      continue;
    }
    const summed = sumCost(entry);
    total += summed.total;
    found = found || summed.found;
  }
  return { total, found };
}

function findIsError(value: unknown): boolean {
  const found = findFirst(value, /is_error/i, (entry) => (entry === true ? true : undefined));
  return found === true;
}

function extractUsageAndCost(
  stdout: string,
  stderr: string,
): { usage?: unknown; cost?: number; isError: boolean } {
  const candidates = [...parseJsonObjects(stdout), ...parseJsonObjects(stderr)];
  let usage: unknown;
  let totalCost = 0;
  let hasCost = false;
  let isError = false;

  for (const candidate of candidates) {
    if (usage === undefined) {
      usage = findUsage(candidate);
    }
    const cost = sumCost(candidate);
    totalCost += cost.total;
    hasCost = hasCost || cost.found;
    isError = isError || findIsError(candidate);
  }

  return {
    usage,
    cost: hasCost ? totalCost : undefined,
    isError,
  };
}

function getAgentEmail(
  env: NodeJS.ProcessEnv,
  cwd: string,
): { email?: string; firstName?: string; lastName?: string; error?: string } {
  const status = spawnSync('agent', ['status', '--format', 'json'], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: TEN_MB,
  });

  const spawnError = status.error as NodeJS.ErrnoException | undefined;
  if (spawnError?.code === 'ENOENT') {
    return { error: AGENT_NOT_FOUND_ERROR };
  }

  if (status.error || status.status !== 0) {
    return { error: EMAIL_UNRESOLVED_ERROR };
  }

  try {
    const parsed = JSON.parse(status.stdout ?? '') as {
      userInfo?: { email?: string; firstName?: string; lastName?: string };
    };
    const email = parsed.userInfo?.email;
    if (!email) {
      return { error: EMAIL_UNRESOLVED_ERROR };
    }
    return {
      email,
      firstName: parsed.userInfo?.firstName,
      lastName: parsed.userInfo?.lastName,
    };
  } catch {
    return { error: EMAIL_UNRESOLVED_ERROR };
  }
}

function writeFixtureFiles(
  fixture: ProbeFixture,
  factoryHome: string,
  repoRoot: string,
  copyToRepo: boolean,
): void {
  const homeFixtureDir = join(factoryHome, 'probe');
  mkdirSync(homeFixtureDir, { recursive: true });
  const homeFixturePath = join(homeFixtureDir, `${fixture.cli}.json`);
  writeFileSync(homeFixturePath, JSON.stringify(fixture, null, 2) + '\n', 'utf8');

  if (copyToRepo) {
    // Proposed path from FAC-3 plan; can change if FAC-4 needs another location.
    const repoFixtureDir = join(repoRoot, 'test', 'fixtures', 'cli', fixture.cli);
    mkdirSync(repoFixtureDir, { recursive: true });
    const repoFixturePath = join(repoFixtureDir, 'probe.json');
    copyFileSync(homeFixturePath, repoFixturePath);
  }
}

function writeSummaryFiles(summary: ProbeCostSummary, factoryHome: string, repoRoot: string): void {
  const homeFixtureDir = join(factoryHome, 'probe');
  mkdirSync(homeFixtureDir, { recursive: true });
  const homeSummaryPath = join(homeFixtureDir, 'summary.json');
  writeFileSync(homeSummaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');

  const repoFixtureDir = join(repoRoot, 'test', 'fixtures', 'cli');
  mkdirSync(repoFixtureDir, { recursive: true });
  const repoSummaryPath = join(repoFixtureDir, 'summary.json');
  copyFileSync(homeSummaryPath, repoSummaryPath);
}

function buildFailureFixture(spec: {
  cli: ProbeCliName;
  args: string[];
  cliVersion?: string;
}): ProbeFixture {
  return {
    cli: spec.cli,
    prompt: PROBE_PROMPT,
    args: spec.args,
    stdout: '',
    stderr: '',
    exitCode: null,
    durationMs: 0,
    cliVersion: spec.cliVersion ?? 'unknown',
    cost: 'unknown',
    failed: true,
    budgetExceeded: false,
  };
}

export function runProbe(options: RunProbeOptions = {}): ProbeRunSummary {
  const env = options.env ?? process.env;
  const out = options.out ?? process.stdout;
  const repoRoot = resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);

  assertLive(env);
  const factoryHome = resolveFactoryHome(env);

  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    FACTORY_HOME: factoryHome,
  };
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith('XDG_') || key.startsWith('OPENCODE_')) {
      delete childEnv[key];
    }
  }

  const specs = buildProbeRunnerSpecs(factoryHome);
  const cursorSpec = specs.find((spec) => spec.cli === 'cursor-agent');
  if (!cursorSpec) {
    throw new Error('cursor-agent probe spec is required.');
  }
  mkdirSync(cursorSpec.cwd, { recursive: true });
  const agentAccount = getAgentEmail(childEnv, cursorSpec.cwd);
  const redaction = buildRedactionValues({
    env,
    factoryHome,
    agentEmail: agentAccount.email,
    agentFirstName: agentAccount.firstName,
    agentLastName: agentAccount.lastName,
  });

  const fixtures: ProbeFixture[] = [];
  const costByCli: Record<ProbeCliName, number | 'unknown'> = {
    'cursor-agent': 'unknown',
    opencode: 'unknown',
  };
  let totalReportedCostUsd = 0;
  let hasAnyReportedCost = false;
  let failed = false;

  for (const spec of specs) {
    let fixture: ProbeFixture;

    try {
      if (spec.cli === 'cursor-agent' && !agentAccount.email) {
        const version = readProbeCliVersion(spec, childEnv);
        fixture = buildFailureFixture({ ...spec, cliVersion: version.cliVersion });
        fixture.cliVersionSource = 'version_flag';
        fixture.error = agentAccount.error ?? EMAIL_UNRESOLVED_ERROR;
        if (version.error) {
          fixture.error = `${fixture.error}; ${version.error}`;
        }
      } else {
        const outcome = runProbeCli(spec, childEnv);
        const extracted = extractUsageAndCost(outcome.stdout, outcome.stderr);

        let budgetExceeded = false;
        let error = outcome.errorMessage;
        if (extracted.cost !== undefined) {
          const budget = new Budget(1);
          const recordCost = (): void => {
            hasAnyReportedCost = true;
            costByCli[spec.cli] = extracted.cost as number;
            totalReportedCostUsd += extracted.cost as number;
          };
          try {
            budget.add(extracted.cost);
            recordCost();
          } catch (budgetError) {
            if (budgetError instanceof BudgetExceeded) {
              recordCost();
              budgetExceeded = true;
              error = budgetError.message;
            } else {
              throw budgetError;
            }
          }
        }
        if (extracted.isError && !error) {
          error = 'CLI reported is_error=true';
        }

        fixture = {
          cli: spec.cli,
          prompt: PROBE_PROMPT,
          args: spec.args,
          stdout: outcome.stdout,
          stderr: outcome.stderr,
          exitCode: outcome.exitCode,
          durationMs: outcome.durationMs,
          usage: extracted.usage,
          cliVersion: outcome.cliVersion,
          cliVersionSource: 'version_flag',
          cost: extracted.cost ?? 'unknown',
          failed:
            extracted.isError ||
            budgetExceeded ||
            Boolean(outcome.errorMessage) ||
            outcome.signal !== null ||
            outcome.exitCode !== 0,
          budgetExceeded,
          error,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fixture = buildFailureFixture(spec);
      fixture.error = message;
    }

    const redactedFixture = redactProbeValue(fixture, redaction.values);
    try {
      writeFixtureFiles(redactedFixture, factoryHome, repoRoot, !redactedFixture.failed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      redactedFixture.failed = true;
      redactedFixture.error = redactedFixture.error
        ? `${redactedFixture.error}; failed to write fixture: ${message}`
        : `failed to write fixture: ${message}`;
    }

    if (redactedFixture.failed) {
      failed = true;
    }
    fixtures.push(redactedFixture);
  }

  const unknownCostClis = Object.entries(costByCli)
    .filter(([, value]) => value === 'unknown')
    .map(([cli]) => cli as ProbeCliName);

  const summary: ProbeCostSummary = {
    totalReportedCostUsd: hasAnyReportedCost ? totalReportedCostUsd : 'unknown',
    partialUnknownClis: unknownCostClis,
    costByCli,
    skippedRedactionEnvNames: redaction.skippedEnvNames,
  };
  try {
    writeSummaryFiles(summary, factoryHome, repoRoot);
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    out.write(`failed to write summary: ${message}\n`);
  }

  const printedTotal =
    hasAnyReportedCost && unknownCostClis.length > 0
      ? `$${totalReportedCostUsd.toFixed(6)} (partial: ${unknownCostClis.join(', ')} unknown)`
      : hasAnyReportedCost
        ? `$${totalReportedCostUsd.toFixed(6)}`
        : 'unknown';
  out.write(`Total reported probe cost: ${printedTotal}\n`);
  return {
    factoryHome,
    totalReportedCostUsd: summary.totalReportedCostUsd,
    failed,
    fixtures,
  };
}

function runCli(argv: string[], env: NodeJS.ProcessEnv): void {
  if (argv.length > 0) {
    throw new Error('Usage: npm run probe');
  }
  const result = runProbe({ env });
  if (result.failed) {
    process.exitCode = 1;
  }
}

runAsMain(import.meta.url, () => {
  runCli(process.argv.slice(2), process.env);
});
