import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { PROBE_PROMPT } from './prompt.js';

export type ProbeCliName = 'cursor-agent' | 'opencode';

export interface ProbeRunnerSpec {
  cli: ProbeCliName;
  command: string;
  args: string[];
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
      helpArgs: ['--help'],
      requiredFlags: ['-p', '--mode', '--trust', '--output-format', '--model'],
      cwd: join(sandboxRoot, 'probe-cursor-agent'),
      timeoutMs: TWO_MINUTES_MS,
    },
    {
      cli: 'opencode',
      command: 'opencode',
      args: ['run', '--format', 'json', '--model', OPENCODE_MODEL, PROBE_PROMPT],
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

export function runProbeCli(spec: ProbeRunnerSpec, env: NodeJS.ProcessEnv): ProbeRunnerOutcome {
  mkdirSync(spec.cwd, { recursive: true });

  const helpError = validateHelpFlags(spec, env);
  if (helpError) {
    return {
      stdout: '',
      stderr: '',
      exitCode: null,
      durationMs: 0,
      signal: null,
      errorMessage: helpError,
    };
  }

  const startedAt = Date.now();
  const result = spawnSync(spec.command, spec.args, {
    cwd: spec.cwd,
    env,
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
    errorMessage: result.error?.message,
  };
}
