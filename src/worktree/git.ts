import { spawnSync } from 'node:child_process';

export interface GitResult {
  ok: boolean;
  stdout: string;
  /** Git's error text when `ok` is false. */
  stderr: string;
}

/**
 * Runs git in `cwd` with a minimal environment: no system config, no prompts. The caller must
 * have checked that `cwd` exists. Never throws on a git failure. `extraEnv` adds git variables such as
 * `GIT_INDEX_FILE` to that minimal environment.
 */
export function runGit(
  env: NodeJS.ProcessEnv,
  cwd: string,
  args: readonly string[],
  extraEnv: Readonly<Record<string, string>> = {},
): GitResult {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: env.PATH ?? process.env.PATH ?? '',
      HOME: env.HOME ?? '',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      ...extraEnv,
    },
  });
  const failed = result.error !== undefined || result.status !== 0;
  return {
    ok: !failed,
    stdout: result.stdout.trim(),
    stderr: (result.error?.message ?? result.stderr).trim(),
  };
}
