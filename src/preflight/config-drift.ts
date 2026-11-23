import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { Config } from '../config/schema.js';
import { FactoryError } from '../platform/errors.js';

type PackageManager = Config['package_manager'];

const LOCKFILES: Record<PackageManager, string> = {
  npm: 'package-lock.json',
  pnpm: 'pnpm-lock.yaml',
  yarn: 'yarn.lock',
};

const MANAGERS = Object.keys(LOCKFILES);

/** Subcommands that are package-manager builtins, not scripts. `test` is handled on its own. */
const BUILTINS = new Set([
  'add', 'audit', 'cache', 'ci', 'config', 'create', 'dedupe', 'dlx', 'exec', 'fetch', 'i', 'info', 'init',
  'install', 'install-test', 'it', 'link', 'list', 'login', 'ls', 'outdated', 'pack', 'prune', 'publish',
  'rebuild', 'remove', 'rm', 'store', 'uninstall', 'up', 'update', 'version', 'view', 'why', 'x',
]);

/** npm runs the `test` script for these aliases. pnpm and yarn treat `test` as a script name. */
const NPM_TEST_ALIASES = new Set(['test', 't', 'tst']);

export interface ConfigDriftInput {
  config: Pick<Config, 'package_manager' | 'install' | 'gates' | 'gates_cwd'>;
  repoPath: string;
  /** The repo config file, named in the refusal. */
  repoConfigFile: string;
}

function drift(key: string, problem: string, fix: string, where: string): FactoryError {
  return new FactoryError({
    code: 'config_drift',
    message: `Config drift in ${key}: ${problem}`,
    where,
    next: `${fix} Then run preflight again.`,
    exitCode: 2,
  });
}

/** The `scripts` of a package.json, or undefined when the file is missing or unreadable. */
function readScripts(packageJson: string): Record<string, unknown> | undefined {
  if (!existsSync(packageJson)) return undefined;
  try {
    const scripts = (JSON.parse(readFileSync(packageJson, 'utf8')) as { scripts?: unknown }).scripts;
    return typeof scripts === 'object' && scripts !== null ? (scripts as Record<string, unknown>) : {};
  } catch {
    return undefined;
  }
}

/** The script a package-manager command runs, or `null` for a builtin or a shape that is not checked. */
function scriptOf(tokens: string[], manager: string): string | null {
  const [, sub, ...rest] = tokens;
  if (sub === undefined || sub.startsWith('-')) return null;
  if (sub === 'run' || sub === 'run-script') return rest.find((token) => !token.startsWith('-')) ?? null;
  if (manager === 'npm') return NPM_TEST_ALIASES.has(sub) ? 'test' : null;
  if (sub === 'test') return 'test';
  return BUILTINS.has(sub) ? null : sub;
}

/**
 * Checks one command, never runs it. Returns the problem in words, or undefined when the command
 * matches the repo. Only package.json scripts, the configured package manager and repo-relative files
 * are checked: no real PATH or network lookup.
 */
function commandProblem(
  command: string,
  manager: PackageManager,
  scripts: Record<string, unknown> | undefined,
  scriptsFile: string,
  cwd: string,
  repoPath: string,
): string | undefined {
  for (const segment of command.split(/\s*(?:&&|\|\||;)\s*/)) {
    const tokens = segment.trim().split(/\s+/);
    const first = tokens[0] ?? '';
    if (first === 'npx') {
      if (manager !== 'npm') return `"${command}" uses npx but package_manager is ${manager}.`;
    } else if (MANAGERS.includes(first)) {
      if (first !== manager) return `"${command}" uses ${first} but package_manager is ${manager}.`;
      const script = scriptOf(tokens, manager);
      if (script !== null && !(scripts !== undefined && Object.hasOwn(scripts, script))) {
        return scripts === undefined
          ? `"${command}" runs script "${script}", but ${scriptsFile} does not exist or cannot be read.`
          : `"${command}" runs script "${script}", which is not in the scripts of ${scriptsFile}.`;
      }
    } else if (/^\.{1,2}\//.test(first)) {
      const target = resolve(cwd, first);
      const fromRepo = relative(repoPath, target);
      if (fromRepo === '..' || fromRepo.startsWith(`..${sep}`) || isAbsolute(fromRepo)) {
        return `"${command}" runs ${first}, which is outside the repo.`;
      }
      if (!existsSync(target)) return `"${command}" runs ${first}, which does not exist in the repo.`;
    }
  }
  return undefined;
}

/**
 * Refuses a config that no longer matches the repo as `config_drift`: the package manager must have its
 * lockfile at the repo root, and `install` and every gate that is set must still resolve to a script in
 * the package.json under `gates_cwd`, a builtin of the configured package manager, or a repo file.
 */
export function checkConfigDrift({ config, repoPath, repoConfigFile }: ConfigDriftInput): void {
  const manager = config.package_manager;
  const lockfile = LOCKFILES[manager];
  if (!existsSync(join(repoPath, lockfile))) {
    const found = Object.values(LOCKFILES).filter((name) => existsSync(join(repoPath, name)));
    throw drift(
      'package_manager',
      `package_manager is ${manager} but the repo has no ${lockfile}${found.length > 0 ? ` (found ${found.join(', ')})` : ''}.`,
      `Set package_manager in ${repoConfigFile} to the manager that owns the lockfile, or restore ${lockfile}.`,
      repoConfigFile,
    );
  }

  const cwd = join(repoPath, config.gates_cwd);
  const packageJson = join(cwd, 'package.json');
  const scripts = readScripts(packageJson);
  const commands: Array<[string, string]> = [
    ['install', config.install],
    ...(['lint', 'typecheck', 'test', 'build', 'e2e'] as const).flatMap(
      (gate): Array<[string, string]> => {
        const command = config.gates[gate];
        return typeof command === 'string' ? [[`gates.${gate}`, command]] : [];
      },
    ),
  ];
  for (const [key, command] of commands) {
    const problem = commandProblem(command, manager, scripts, packageJson, cwd, repoPath);
    if (problem !== undefined) {
      throw drift(
        key,
        problem,
        `Change ${key} in ${repoConfigFile}, or restore what it points at in the repo.`,
        repoConfigFile,
      );
    }
  }
}
