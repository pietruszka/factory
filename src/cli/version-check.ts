import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { refused } from '../platform/errors.js';

/** Oldest supported versions (D-38 for Node; git is the plan's proposed minimum). */
export const MIN_NODE = '22.13';
export const MIN_GIT = '2.40';

export interface EnvironmentProbe {
  /** For example `v22.13.0`. */
  processVersion: string;
  /** Resolves with the output of `git --version`; rejects when git cannot be started. */
  runGitVersion: () => Promise<string>;
}

interface Version {
  major: number;
  minor: number;
  /** For example `22.13.0`. */
  text: string;
}

/** Reads the first `major.minor` number pair in the text, for example from `git version 2.47.1`. */
function parseVersion(text: string): Version | null {
  const match = /(\d+)\.(\d+)(?:\.\d+)?/.exec(text);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), text: match[0] };
}

function atLeast(version: Version | null, minimum: string): boolean {
  const min = parseVersion(minimum);
  if (!version || !min) return false;
  return version.major !== min.major ? version.major > min.major : version.minor >= min.minor;
}

/**
 * Refuses an old Node, a missing git or an old git by throwing a `FactoryError` with exit code 2.
 * Pass `checkGit: false` for commands that must answer at once.
 */
export async function checkEnvironment(
  probe: EnvironmentProbe,
  opts: { checkGit: boolean },
): Promise<void> {
  const node = parseVersion(probe.processVersion);
  if (!atLeast(node, MIN_NODE)) {
    throw refused({
      code: 'node_too_old',
      message: `Node.js ${MIN_NODE} or newer is required; this is ${node?.text ?? probe.processVersion}.`,
      where: 'node',
      next: `install Node.js ${MIN_NODE} or newer`,
    });
  }
  if (!opts.checkGit) return;

  let output: string;
  try {
    output = await probe.runGitVersion();
  } catch {
    throw refused({
      code: 'git_missing',
      message: `git was not found; git ${MIN_GIT} or newer is required.`,
      where: 'git',
      next: `install git ${MIN_GIT} or newer`,
    });
  }
  const git = parseVersion(output);
  if (!atLeast(git, MIN_GIT)) {
    throw refused({
      code: 'git_too_old',
      message: `git ${MIN_GIT} or newer is required; found ${git?.text ?? 'an unreadable version'}.`,
      where: 'git',
      next: `update git to ${MIN_GIT} or newer`,
    });
  }
}

const execFileAsync = promisify(execFile);

/** Runs `git --version`: fixed argument list, no shell, short timeout. Not used by unit tests. */
export async function runGitVersion(): Promise<string> {
  const { stdout } = await execFileAsync('git', ['--version'], { timeout: 5000 });
  return stdout;
}
