import { spawnSync } from 'node:child_process';

export interface GitResult {
  ok: boolean;
  stdout: string;
  /** Git's error text when `ok` is false. */
  stderr: string;
}

/** How much of the user's git config the command may see. */
type GitProfile = 'user' | 'isolated';

export interface RunGitOptions {
  /**
   * `user`: the work repo. Reads `$HOME/.gitconfig`. No system config, no prompts.
   * shortcut: repo hooks and core.fsmonitor still run, when FAC-54 item 1 lands in this runner.
   * `isolated`: sandbox unpack and config/load. No global config, hooks off.
   */
  profile: GitProfile;
  /** Extra git variables such as `GIT_INDEX_FILE`. */
  extraEnv?: Readonly<Record<string, string>>;
}

/**
 * Runs git in `cwd` with the named profile. The caller must have checked that `cwd` exists.
 * Never throws on a git failure.
 */
export function runGit(
  env: NodeJS.ProcessEnv,
  cwd: string,
  args: readonly string[],
  options: RunGitOptions,
): GitResult {
  const isolated = options.profile === 'isolated';
  const gitArgs = isolated ? ['-c', 'core.hooksPath=/dev/null', ...args] : [...args];
  const result = spawnSync('git', gitArgs, {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: env.PATH ?? process.env.PATH ?? '',
      HOME: env.HOME ?? '',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      ...(isolated ? { GIT_CONFIG_GLOBAL: '/dev/null' } : {}),
      ...options.extraEnv,
    },
  });
  const failed = result.error !== undefined || result.status !== 0;
  return {
    ok: !failed,
    stdout: result.stdout.trim(),
    stderr: (result.error?.message ?? result.stderr).trim(),
  };
}
