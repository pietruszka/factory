import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve, isAbsolute } from 'node:path';

import { createSystemDeps, type Deps } from '../platform/deps.js';
import { PROBE_PROMPT } from './prompt.js';

export type ProbeCliName = 'cursor-agent' | 'opencode';

export interface ProbeRunnerSpec {
  cli: ProbeCliName;
  command: string;
  args: string[];
  versionArgs: string[];
  helpArgs: string[];
  requiredFlags: string[];
  cwd: string;
  timeoutMs: number;
  /** Model id that must appear in the CLI's model list before the run (OpenCode 2.x warm-up). */
  warmupModel?: string;
  warmupArgs?: string[];
  warmupAttempts?: number;
  warmupDelayMs?: number;
}

/** Flags the factory must never pass. OpenCode 2.x `--auto` auto-approves permissions. */
export const FORBIDDEN_CLI_FLAGS: Record<ProbeCliName, readonly string[]> = {
  'cursor-agent': [],
  opencode: ['--auto'],
};

const MAC_PRIVACY_PROTECTED_DIRS = ['Documents', 'Desktop', 'Downloads'];

/**
 * True when `path` is inside ~/Documents, ~/Desktop or ~/Downloads. The OpenCode 2.x background
 * service is started by launchd and macOS denies it these folders (EPERM), so requests whose
 * directory is there fail with HTTP 500.
 */
export function isMacPrivacyProtectedPath(path: string, userHome: string | undefined): boolean {
  if (!userHome) {
    return false;
  }
  const rel = relative(resolve(userHome), resolve(path));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    return false;
  }
  const first = rel.split(/[\\/]/)[0];
  return first !== undefined && MAC_PRIVACY_PROTECTED_DIRS.includes(first);
}

function sleepMs(ms: number): void {
  if (ms > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }
}

export interface ProbeRunnerOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  signal: NodeJS.Signals | null;
  cliVersion: string;
  errorMessage?: string;
}

const TWO_MINUTES_MS = 120_000;
const TEN_MB = 10 * 1024 * 1024;

// Confirmed by `agent models` on 2026-11-20.
export const CURSOR_AGENT_MODEL = 'gpt-5.4-nano-none';
// Confirmed by `opencode models` on 2026-11-20 (1.19.5) and 2026-11-21 (2.3.2).
export const OPENCODE_MODEL = 'opencode/beam-free';

export function buildProbeRunnerSpecs(factoryHome: string): ProbeRunnerSpec[] {
  const sandboxRoot = join(factoryHome, 'sandbox');

  return [
    {
      cli: 'cursor-agent',
      command: 'agent',
      args: [
        '-p',
        '--mode',
        'ask',
        '--trust',
        '--output-format',
        'json',
        '--model',
        CURSOR_AGENT_MODEL,
        PROBE_PROMPT,
      ],
      versionArgs: ['--version'],
      helpArgs: ['--help'],
      requiredFlags: ['-p', '--mode', '--trust', '--output-format', '--model'],
      cwd: join(sandboxRoot, 'probe-cursor-agent'),
      timeoutMs: TWO_MINUTES_MS,
    },
    {
      cli: 'opencode',
      command: 'opencode',
      // 2.x: `--archived` keeps probe sessions out of the owner's session list; the built-in
      // `plan` agent denies edits (closest to Cursor's `--mode ask`). Never `--auto`.
      args: ['run', '--format', 'json', '--archived', '--agent', 'plan', '--model', OPENCODE_MODEL, PROBE_PROMPT],
      versionArgs: ['--version'],
      helpArgs: ['run', '--help'],
      requiredFlags: ['run', '--format', '--model', '--agent', '--archived'],
      cwd: join(sandboxRoot, 'probe-opencode'),
      timeoutMs: TWO_MINUTES_MS,
      // The 2.x background service loads plugin models (cursor-acp/) per directory after a few seconds.
      warmupModel: OPENCODE_MODEL,
      warmupArgs: ['models'],
      warmupAttempts: 10,
      warmupDelayMs: 2_000,
    },
  ];
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function helpTextContainsFlag(helpText: string, flag: string): boolean {
  const escaped = escapeForRegExp(flag);
  return new RegExp(`(^|\\s)${escaped}(?=\\s|$|[\\],)=:])`).test(helpText);
}

function validateHelpFlags(spec: ProbeRunnerSpec, env: NodeJS.ProcessEnv): string | undefined {
  const check = spawnSync(spec.command, spec.helpArgs, {
    cwd: spec.cwd,
    env,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: TEN_MB,
  });

  if (check.error) {
    return `help check failed: ${check.error.message}`;
  }

  const helpText = `${check.stdout ?? ''}${check.stderr ?? ''}`;
  const missingFlags = spec.requiredFlags.filter((flag) => !helpTextContainsFlag(helpText, flag));
  if (missingFlags.length > 0) {
    return `help output is missing expected flags: ${missingFlags.join(', ')}`;
  }

  return undefined;
}

export function readProbeCliVersion(
  spec: ProbeRunnerSpec,
  env: NodeJS.ProcessEnv,
): { cliVersion: string; error?: string } {
  mkdirSync(spec.cwd, { recursive: true });
  const check = spawnSync(spec.command, spec.versionArgs, {
    cwd: spec.cwd,
    env,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: TEN_MB,
  });

  if (check.error) {
    return { cliVersion: 'unknown', error: `version check failed: ${check.error.message}` };
  }
  if (check.status !== 0) {
    return { cliVersion: 'unknown', error: 'version check failed: non-zero exit' };
  }

  const output = `${check.stdout ?? ''}\n${check.stderr ?? ''}`
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!output) {
    return { cliVersion: 'unknown', error: 'version check failed: empty output' };
  }
  return { cliVersion: output };
}

function waitForModel(spec: ProbeRunnerSpec, env: NodeJS.ProcessEnv): string | undefined {
  if (!spec.warmupModel || !spec.warmupArgs) {
    return undefined;
  }
  const attempts = Math.max(1, spec.warmupAttempts ?? 1);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync(spec.command, spec.warmupArgs, {
      cwd: spec.cwd,
      env,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: TEN_MB,
    });
    if (result.error) {
      return `model list failed: ${result.error.message}`;
    }
    const listed = (result.stdout ?? '').split('\n').map((line) => line.trim());
    if (result.status === 0 && listed.includes(spec.warmupModel)) {
      return undefined;
    }
    if (attempt < attempts) {
      sleepMs(spec.warmupDelayMs ?? 0);
    }
  }
  return `model ${spec.warmupModel} is not listed by \`${spec.command} ${spec.warmupArgs.join(' ')}\` after ${attempts} attempts`;
}

function refusalOutcome(errorMessage: string, cliVersion = 'unknown'): ProbeRunnerOutcome {
  return { stdout: '', stderr: '', exitCode: null, durationMs: 0, signal: null, cliVersion, errorMessage };
}

export function runProbeCli(
  spec: ProbeRunnerSpec,
  env: NodeJS.ProcessEnv,
  deps: Deps = createSystemDeps(),
  os: NodeJS.Platform = process.platform,
): ProbeRunnerOutcome {
  const forbidden = FORBIDDEN_CLI_FLAGS[spec.cli].find((flag) => spec.args.includes(flag));
  if (forbidden) {
    return refusalOutcome(`forbidden flag: ${forbidden}`);
  }
  if (
    os === 'darwin' &&
    spec.cli === 'opencode' &&
    isMacPrivacyProtectedPath(spec.cwd, env.HOME)
  ) {
    return refusalOutcome(
      'opencode sandbox is inside a macOS privacy-protected folder (~/Documents, ~/Desktop or ~/Downloads); ' +
        'the OpenCode background service cannot read it. Put FACTORY_HOME elsewhere.',
    );
  }
  const childEnv: NodeJS.ProcessEnv = { ...env, PWD: spec.cwd };
  env = childEnv;
  const version = readProbeCliVersion(spec, env);
  if (version.error) {
    return {
      stdout: '',
      stderr: '',
      exitCode: null,
      durationMs: 0,
      signal: null,
      cliVersion: version.cliVersion,
      errorMessage: version.error,
    };
  }

  const helpError = validateHelpFlags(spec, env);
  if (helpError) {
    return {
      stdout: '',
      stderr: '',
      exitCode: null,
      durationMs: 0,
      signal: null,
      cliVersion: version.cliVersion,
      errorMessage: helpError,
    };
  }

  const warmupError = waitForModel(spec, env);
  if (warmupError) {
    return refusalOutcome(warmupError, version.cliVersion);
  }

  const startedAt = deps.now();
  const result = spawnSync(spec.command, spec.args, {
    cwd: spec.cwd,
    // OpenCode's cursor-acp/ bridge resolves relative tool paths against PWD, not the process cwd.
    // Without this, a probe started from the repo wrote into the repo instead of the sandbox.
    env: { ...env, PWD: spec.cwd },
    encoding: 'utf8',
    timeout: spec.timeoutMs,
    maxBuffer: TEN_MB,
  });
  const endedAt = deps.now();

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status,
    durationMs: endedAt - startedAt,
    signal: result.signal,
    cliVersion: version.cliVersion,
    errorMessage: result.error?.message,
  };
}
