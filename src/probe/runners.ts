import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

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
// Confirmed by `opencode models` on 2026-11-20.
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
      args: ['run', '--format', 'json', '--model', OPENCODE_MODEL, PROBE_PROMPT],
      versionArgs: ['--version'],
      helpArgs: ['run', '--help'],
      requiredFlags: ['run', '--format', '--model'],
      cwd: join(sandboxRoot, 'probe-opencode'),
      timeoutMs: TWO_MINUTES_MS,
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

export function runProbeCli(spec: ProbeRunnerSpec, env: NodeJS.ProcessEnv): ProbeRunnerOutcome {
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

  const startedAt = Date.now();
  const result = spawnSync(spec.command, spec.args, {
    cwd: spec.cwd,
    // OpenCode's cursor-acp/ bridge resolves relative tool paths against PWD, not the process cwd.
    // Without this, a probe started from the repo wrote into the repo instead of the sandbox.
    env: { ...env, PWD: spec.cwd },
    encoding: 'utf8',
    timeout: spec.timeoutMs,
    maxBuffer: TEN_MB,
  });
  const endedAt = Date.now();

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
