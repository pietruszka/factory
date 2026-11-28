import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { z } from 'zod';

import { FactoryError } from '../platform/errors.js';
import { resolveFactoryPaths } from '../platform/paths.js';
import { normaliseOrigin, samePath } from './origin.js';
import {
  GlobalFileSchema,
  MergedConfigSchema,
  RepoFileSchema,
  type Config,
  type PartialConfig,
  type RepoFile,
} from './schema.js';
import { assertNoSecrets } from './secrets.js';
import { readYamlConfig, type YamlConfig } from './yaml.js';

export interface LoadOptions {
  env: NodeJS.ProcessEnv;
  repoPath: string;
  /** Overrides the git origin. `null` means the repo has no origin. */
  originUrl?: string | null;
}

export interface LoadedGlobalConfig {
  file: string;
  config: PartialConfig;
}

export interface LoadedConfig {
  config: Config;
  hash: { algorithm: 'sha256'; digest: string };
  files: { global: string; repo: string };
}

type Plain = Record<string, unknown>;

/** Values used when neither file sets a key (FR-9 caps, estimates). */
const DEFAULTS = {
  version: 1,
  models: {},
  caps: {
    A: { usd: 5, minutes: 30, fix_loops: 2 },
    E: { usd: 6, minutes: 45, fix_loops: 2 },
    F: { usd: 2, minutes: 15, fix_loops: 2 },
    H: { usd: 2, minutes: 15, fix_loops: 2 },
  },
  rate_table: {},
  secrets: {},
  inspector: { host: '127.0.0.1', port: 0 },
  dev_harness: { repeats: 3 },
  gates: {},
  protected_globs: [],
  forbidden_globs: [],
  role_write_globs: {},
  risk_tiers: {},
  snapshot_ignore: [],
  pr_labels: [],
  gates_cwd: '.',
  timing_sensitive_repeats: 3,
  timing_sensitive_globs: [],
};

const isPlain = (value: unknown): value is Plain =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Objects merge key by key; arrays and scalars in `over` replace the ones in `base`. */
function deepMerge(base: Plain, over: Plain): Plain {
  const merged: Plain = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const current = merged[key];
    merged[key] = isPlain(value) && isPlain(current) ? deepMerge(current, value) : value;
  }
  return merged;
}

function invalid(file: string, line: number, message: string, next: string): FactoryError {
  return new FactoryError({ code: 'config_invalid', message, where: `${file}:${line}`, next, exitCode: 2 });
}

interface ParsedFile {
  file: string;
  doc: YamlConfig;
  value: Plain;
}

function parseFile(file: string): ParsedFile {
  const doc = readYamlConfig({ file, bytes: readFileSync(file) });
  if (doc.value !== null && !isPlain(doc.value)) {
    throw invalid(file, 1, 'The config file must be a mapping of keys to values.', 'Start the file with `key: value` lines.');
  }
  assertNoSecrets({ file, value: doc.value, lineOf: (path) => doc.lineOf(path) });
  return { file, doc, value: doc.value ?? {} };
}

/** Zod's first issue as a key path, a message and the YAML line of that key. */
function describeIssue(issue: z.core.$ZodIssue): { path: Array<string | number>; message: string } {
  const path = issue.path.map((part) => (typeof part === 'symbol' ? String(part) : part));
  if (issue.code === 'unrecognized_keys') {
    const key = issue.keys[0] ?? '';
    return { path: [...path, key], message: `Unknown key "${[...path, key].join('.')}".` };
  }
  const key = path.join('.');
  if (issue.code === 'invalid_type' && issue.message.includes('received undefined')) {
    return { path, message: `Missing required key "${key}".` };
  }
  return { path, message: `Invalid value for "${key}": ${issue.message}.` };
}

function validate<T>(schema: z.ZodType, parsed: ParsedFile, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data as T;
  }
  const issue = result.error.issues[0];
  if (!issue) {
    throw invalid(parsed.file, 1, 'The config is invalid.', 'Fix the config file.');
  }
  const { path, message } = describeIssue(issue);
  throw invalid(
    parsed.file,
    parsed.doc.lineOf(path),
    message,
    'Fix that key in the config file. See docs/reference/factory-config.md for the allowed keys and values.',
  );
}

function readGlobal(env: NodeJS.ProcessEnv): { parsed: ParsedFile; config: PartialConfig } {
  const { configPath } = resolveFactoryPaths(env);
  if (!existsSync(configPath)) {
    throw new FactoryError({
      code: 'config_missing',
      message: 'The factory config file does not exist.',
      where: configPath,
      next: `Create ${configPath}, or run \`factory dev-init <throwaway-folder>\` to make a throwaway home with a starter config.`,
      exitCode: 2,
    });
  }
  const parsed = parseFile(configPath);
  return { parsed, config: validate<PartialConfig>(GlobalFileSchema, parsed, parsed.value) };
}

/** Reads and validates `<home>/config.yaml` on its own. Writes nothing. */
export function loadGlobalConfig(options: { env: NodeJS.ProcessEnv }): LoadedGlobalConfig {
  const { parsed, config } = readGlobal(options.env);
  return { file: parsed.file, config };
}

interface RepoCandidate {
  parsed: ParsedFile;
  repo: RepoFile;
}

function readRepoFiles(reposDir: string): RepoCandidate[] {
  if (!existsSync(reposDir)) {
    return [];
  }
  return readdirSync(reposDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const parsed = parseFile(join(reposDir, name));
      return { parsed, repo: validate<RepoFile>(RepoFileSchema, parsed, parsed.value) };
    });
}

/** The `origin` remote URL of the git repo at `repoPath`, or undefined when there is none. */
function readGitOrigin(repoPath: string, env: NodeJS.ProcessEnv): string | undefined {
  const result = spawnSync('git', ['-C', repoPath, 'remote', 'get-url', 'origin'], {
    encoding: 'utf8',
    env: { PATH: env.PATH ?? process.env.PATH ?? '', HOME: env.HOME ?? '', GIT_CONFIG_NOSYSTEM: '1' },
  });
  const url = result.status === 0 ? result.stdout.trim() : '';
  return url === '' ? undefined : url;
}

function refuseRepoMatch(code: string, message: string, where: string, next: string): FactoryError {
  return new FactoryError({ code, message, where, next, exitCode: 2 });
}

/** Origin match wins over path match. More than one match in the winning group is refused. */
function chooseRepoFile(
  candidates: RepoCandidate[],
  origin: string | undefined,
  repoPath: string,
  reposDir: string,
): RepoCandidate {
  const byOrigin = candidates.filter(
    ({ repo }) =>
      origin !== undefined && repo.match.origin !== undefined && normaliseOrigin(repo.match.origin) === origin,
  );
  const byPath = candidates.filter(
    ({ repo }) => repo.match.path !== undefined && samePath(repo.match.path, repoPath),
  );
  const matches = byOrigin.length > 0 ? byOrigin : byPath;

  const [only, ...others] = matches;
  if (only && others.length === 0) {
    return only;
  }
  if (only) {
    throw refuseRepoMatch(
      'repo_config_ambiguous',
      `More than one repo config matches ${repoPath}: ${matches.map(({ parsed }) => parsed.file).join(', ')}.`,
      reposDir,
      'Keep one file for this repo, or change match.origin or match.path so only one file matches.',
    );
  }
  throw refuseRepoMatch(
    'repo_config_missing',
    `No repo config matches ${repoPath}.`,
    reposDir,
    `Create ${join(reposDir, `${basename(repoPath)}.yaml`)} with match.origin (the git origin URL) or match.path (the absolute path of the repo), plus the required keys.`,
  );
}

/** Keys sorted recursively, no insignificant whitespace. The hash input, so key order never matters. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isPlain(value)) {
    const entries = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Reads global and per-repo config, merges them over the defaults and validates the result. Writes nothing. */
export function loadConfig(options: LoadOptions): LoadedConfig {
  const paths = resolveFactoryPaths(options.env);
  const global = readGlobal(options.env);
  const originUrl =
    options.originUrl === undefined ? readGitOrigin(options.repoPath, options.env) : options.originUrl;
  const origin = originUrl === null || originUrl === undefined ? undefined : normaliseOrigin(originUrl);

  const found = chooseRepoFile(readRepoFiles(paths.reposDir), origin, options.repoPath, paths.reposDir);

  // `match` only selects the file. It is not a setting, so it stays out of the merged config and the hash.
  const repoSettings = Object.fromEntries(Object.entries(found.repo).filter(([key]) => key !== 'match'));
  const merged = deepMerge(deepMerge(structuredClone(DEFAULTS), global.config), repoSettings);
  const config = validate<Config>(MergedConfigSchema, found.parsed, merged);

  return {
    config,
    hash: { algorithm: 'sha256', digest: createHash('sha256').update(canonicalJson(config), 'utf8').digest('hex') },
    files: { global: global.parsed.file, repo: found.parsed.file },
  };
}
