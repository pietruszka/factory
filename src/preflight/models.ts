import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { z } from 'zod';

import {
  MODEL_ROLES,
  ModelsSectionSchema,
  type ModelRole,
  type ModelsSection,
} from '../config/models.js';
import { resolveFactoryHome } from '../dev/home.js';
import { runAsMain } from '../dev/run-as-main.js';

export type HomeModelsConfig = ModelsSection;
export type ModelCatalogByCli = Record<string, string[]>;

export type ModelsPreflightErrorCode =
  | 'missing_role'
  | 'high_fast_model'
  | 'fast_model'
  | 'unknown_family'
  | 'family_label_mismatch'
  | 'same_family_conflict'
  | 'cli_without_usage'
  | 'model_not_accepted_by_cli'
  | 'planner_builder_family_mismatch'
  | 'reviewer_vision_family_mismatch';

export interface ModelsPreflightError {
  code: ModelsPreflightErrorCode;
  role?: ModelRole;
  cli?: string;
  model?: string;
  message: string;
}

interface IndentFrame {
  indent: number;
  node: Record<string, unknown>;
}

const TEN_MB = 10 * 1024 * 1024;
const RESERVED_YAML_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const USAGE_REPORTING_CLIS = new Set(['cursor-agent', 'opencode']);

function createYamlNode(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

function parseScalar(value: string, lineNumber: number): unknown {
  if (value === 'null') {
    return null;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }
  const startsWithQuote = value.startsWith('"');
  const endsWithQuote = value.endsWith('"');
  if (startsWithQuote || endsWithQuote) {
    if (!(startsWithQuote && endsWithQuote)) {
      throw new Error(`line ${lineNumber}: malformed quoted string.`);
    }
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`line ${lineNumber}: malformed quoted string.`);
    }
  }
  return value;
}

function parseSimpleYaml(input: string): Record<string, unknown> {
  const root = createYamlNode();
  const stack: IndentFrame[] = [{ indent: -1, node: root }];
  const lines = input.split('\n');

  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + 1;
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) {
      continue;
    }

    if (rawLine.includes('\t')) {
      throw new Error(`line ${lineNumber}: tabs are not allowed in indentation.`);
    }

    const indent = rawLine.match(/^ */)?.[0].length ?? 0;
    const line = rawLine.trim();
    const match = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/.exec(line);
    if (!match) {
      throw new Error(`line ${lineNumber}: invalid YAML line.`);
    }

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]?.node;
    if (!parent) {
      throw new Error(`line ${lineNumber}: invalid YAML indentation.`);
    }

    const key = match[1];
    if (RESERVED_YAML_KEYS.has(key)) {
      throw new Error(`line ${lineNumber}: reserved key "${key}" is not allowed.`);
    }
    if (Object.prototype.hasOwnProperty.call(parent, key)) {
      throw new Error(`line ${lineNumber}: duplicate key "${key}".`);
    }

    const hasValue = match[2] !== undefined && match[2] !== '';
    if (!hasValue) {
      const child = createYamlNode();
      parent[key] = child;
      stack.push({ indent, node: child });
      continue;
    }

    parent[key] = parseScalar(match[2] as string, lineNumber);
  }

  return root;
}

export function readModelsConfigFromYaml(contents: string): HomeModelsConfig {
  let parsedYaml: Record<string, unknown>;
  try {
    parsedYaml = parseSimpleYaml(contents);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid models config: ${message}`);
  }

  if (!Object.prototype.hasOwnProperty.call(parsedYaml, 'models')) {
    throw new Error('Invalid models config: missing models section.');
  }

  const parsedConfig = z
    .object({
      models: ModelsSectionSchema,
    })
    .safeParse(parsedYaml);

  if (!parsedConfig.success) {
    throw new Error(`Invalid models config: ${parsedConfig.error.issues[0]?.message ?? 'unknown error'}`);
  }

  return parsedConfig.data.models;
}

/**
 * Removes OpenCode-style provider segments, e.g. `cursor-acp/gpt-5.3-codex-high` -> `gpt-5.3-codex-high`.
 * Family and fast checks run on the stripped id so a provider name can never hide or fake a match.
 */
export function stripProviderPrefix(model: string): string {
  return model.includes('/') ? (model.split('/').pop() ?? model) : model;
}

function hasHighFastVariant(model: string): boolean {
  return /-high-fast/i.test(stripProviderPrefix(model));
}

function hasFastSuffix(model: string): boolean {
  return /-fast$|fast=true/i.test(stripProviderPrefix(model));
}

function normalizeModelIdForFamily(model: string): string {
  const withoutProviderPrefix = stripProviderPrefix(model);
  const withoutOverrides = withoutProviderPrefix.split('[')[0] ?? withoutProviderPrefix;
  return withoutOverrides.toLowerCase();
}

function deriveFamilyFromModelId(model: string): string | undefined {
  const normalizedModel = normalizeModelIdForFamily(model);
  if (normalizedModel.startsWith('cursor-grok-') || normalizedModel.startsWith('grok-')) {
    return 'grok';
  }
  if (normalizedModel.startsWith('claude-')) {
    return 'claude';
  }
  if (
    normalizedModel.startsWith('gpt-') ||
    normalizedModel.startsWith('o1-') ||
    normalizedModel.startsWith('o3-') ||
    normalizedModel.startsWith('o4-')
  ) {
    return 'gpt';
  }
  if (normalizedModel.startsWith('gemini-')) {
    return 'gemini';
  }
  if (normalizedModel.startsWith('qwen-')) {
    return 'qwen';
  }
  if (normalizedModel.startsWith('deepseek-')) {
    return 'deepseek';
  }
  return undefined;
}

function isAutoModelSelection(model: string): boolean {
  return normalizeModelIdForFamily(model) === 'auto';
}

function roleFamily(role: ModelRole, model: { model: string; family: string }): string | undefined {
  const derivedFamily = deriveFamilyFromModelId(model.model);
  if (role === 'reviewer' || role === 'visionJudge') {
    return derivedFamily;
  }
  return derivedFamily ?? model.family;
}

function hasUsageReportingCli(cli: string): boolean {
  return USAGE_REPORTING_CLIS.has(cli);
}

function hasTipFooterLine(output: string): boolean {
  return output
    .split('\n')
    .map((line) => line.trim())
    .some((line) => /^Tip:\s+/.test(line));
}

function isAcceptedByCli(model: string, acceptedIds: string[]): boolean {
  return acceptedIds.includes(model);
}

export function checkModelsPreflight(
  config: HomeModelsConfig,
  acceptedModelIdsByCli: ModelCatalogByCli,
): ModelsPreflightError[] {
  const errors: ModelsPreflightError[] = [];

  for (const role of MODEL_ROLES) {
    if (!config[role]) {
      errors.push({
        code: 'missing_role',
        role,
        message: `Missing models.${role} entry.`,
      });
    }
  }

  const planner = config.planner;
  const builder = config.builder;
  const reviewer = config.reviewer;
  const visionJudge = config.visionJudge;

  const plannerFamily = planner ? roleFamily('planner', planner) : undefined;
  const builderFamily = builder ? roleFamily('builder', builder) : undefined;
  const reviewerFamily = reviewer ? roleFamily('reviewer', reviewer) : undefined;
  const visionJudgeFamily = visionJudge ? roleFamily('visionJudge', visionJudge) : undefined;

  for (const role of MODEL_ROLES) {
    const roleConfig = config[role];
    if (!roleConfig) {
      continue;
    }
    const autoModel = isAutoModelSelection(roleConfig.model);
    if (autoModel) {
      errors.push({
        code: 'unknown_family',
        role,
        model: roleConfig.model,
        message: `${role} model must not be auto; use an explicit model id.`,
      });
    }
    const derivedFamily = deriveFamilyFromModelId(roleConfig.model);
    if ((role === 'reviewer' || role === 'visionJudge') && !derivedFamily && !autoModel) {
      errors.push({
        code: 'unknown_family',
        role,
        model: roleConfig.model,
        message: `${role} family cannot be derived from model id ${roleConfig.model}.`,
      });
    }
    if (derivedFamily && derivedFamily !== roleConfig.family) {
      errors.push({
        code: 'family_label_mismatch',
        role,
        model: roleConfig.model,
        message: `${role} family label ${roleConfig.family} does not match model-derived family ${derivedFamily}.`,
      });
    }
  }

  if (plannerFamily && builderFamily && plannerFamily !== builderFamily) {
    errors.push({
      code: 'planner_builder_family_mismatch',
      message: 'Planner and builder must use the same family.',
    });
  }

  if (reviewerFamily && visionJudgeFamily && reviewerFamily !== visionJudgeFamily) {
    errors.push({
      code: 'reviewer_vision_family_mismatch',
      message: 'Reviewer and vision judge must use the same family.',
    });
  }

  const producerFamilies = new Set([plannerFamily, builderFamily].filter(Boolean));
  const checkConflict = (role: ModelRole, family: string | undefined): void => {
    if (family && producerFamilies.has(family)) {
      errors.push({
        code: 'same_family_conflict',
        role,
        message: `${role} family must differ from planner/builder family.`,
      });
    }
  };
  checkConflict('reviewer', reviewerFamily);
  checkConflict('visionJudge', visionJudgeFamily);

  for (const role of MODEL_ROLES) {
    const roleConfig = config[role];
    if (!roleConfig) {
      continue;
    }

    if (hasHighFastVariant(roleConfig.model)) {
      errors.push({
        code: 'high_fast_model',
        role,
        model: roleConfig.model,
        message: `${role} model must not include -high-fast.`,
      });
    } else if (hasFastSuffix(roleConfig.model)) {
      errors.push({
        code: 'fast_model',
        role,
        model: roleConfig.model,
        message: `${role} model must not end with -fast.`,
      });
    }

    if (!roleConfig.cli) {
      continue;
    }
    if (!hasUsageReportingCli(roleConfig.cli)) {
      errors.push({
        code: 'cli_without_usage',
        role,
        cli: roleConfig.cli,
        message: `${role} CLI ${roleConfig.cli} does not report usage tokens.`,
      });
    }
    const acceptedIds = acceptedModelIdsByCli[roleConfig.cli] ?? [];
    if (!isAcceptedByCli(roleConfig.model, acceptedIds)) {
      errors.push({
        code: 'model_not_accepted_by_cli',
        role,
        cli: roleConfig.cli,
        model: roleConfig.model,
        message: `${role} model ${roleConfig.model} is not accepted by CLI ${roleConfig.cli}.`,
      });
    }
  }

  return errors;
}

export type ModelCatalogLoader = (clis: string[]) => Promise<ModelCatalogByCli> | ModelCatalogByCli;

export async function runModelsPreflight(
  config: HomeModelsConfig,
  loadCatalog: ModelCatalogLoader,
): Promise<{ ok: boolean; errors: ModelsPreflightError[] }> {
  const requiredClis = Array.from(
    new Set(
      MODEL_ROLES.map((role) => config[role]?.cli)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  );
  const catalog = await loadCatalog(requiredClis);
  const errors = checkModelsPreflight(config, catalog);
  return {
    ok: errors.length === 0,
    errors,
  };
}

export function parseAgentModelsOutput(output: string): string[] {
  if (!hasTipFooterLine(output)) {
    throw new Error('agent models output truncated: missing Tip footer line.');
  }

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = /^([A-Za-z0-9._\-\[\]=,]+) - .+$/.exec(line);
      return match?.[1]?.trim();
    })
    .filter((id): id is string => Boolean(id));
}

/** Parses `opencode models`: one `provider/model` id per line, e.g. `cursor-acp/gpt-5.3-codex-high`. */
export function parseOpenCodeModelsOutput(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._\-\[\]=,]+)+$/.test(line));
}

function commandForCli(cli: string): string {
  if (cli === 'cursor-agent') {
    return 'set -o pipefail; agent models | cat';
  }
  if (cli === 'opencode') {
    return 'set -o pipefail; opencode models | cat';
  }
  throw new Error(`Unsupported CLI for model list lookup: ${cli}`);
}

function loadModelCatalogFromCli(clis: string[], env: NodeJS.ProcessEnv): ModelCatalogByCli {
  const catalog: ModelCatalogByCli = {};
  for (const cli of clis) {
    const command = commandForCli(cli);
    const result = spawnSync('sh', ['-c', command], {
      env,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: TEN_MB,
    });
    if (result.error) {
      throw new Error(`Failed to run ${command}: ${result.error.message}`);
    }
    const stderr = (result.stderr ?? '').trim();
    const stderrSuffix = stderr ? `; stderr: ${stderr}` : '';
    if (result.status !== 0) {
      throw new Error(`Command failed: ${command} (exit ${result.status})${stderrSuffix}`);
    }
    let parsed: string[];
    try {
      parsed =
        cli === 'opencode'
          ? parseOpenCodeModelsOutput(result.stdout ?? '')
          : parseAgentModelsOutput(result.stdout ?? '');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}${stderrSuffix}`);
    }
    if (parsed.length === 0) {
      throw new Error(`No model ids parsed from ${command} output.`);
    }
    catalog[cli] = parsed;
  }
  return catalog;
}

export async function runPreflight(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: boolean; errors: ModelsPreflightError[] }> {
  const factoryHome = resolveFactoryHome(env);
  const configPath = join(factoryHome, 'config.yaml');
  const configContents = readFileSync(configPath, 'utf8');
  const models = readModelsConfigFromYaml(configContents);

  return runModelsPreflight(models, (clis) => loadModelCatalogFromCli(clis, env));
}

async function runCli(argv: string[], env: NodeJS.ProcessEnv): Promise<void> {
  if (argv.length > 0) {
    throw new Error('Usage: npm run preflight');
  }
  const result = await runPreflight(env);
  if (result.ok) {
    process.stdout.write('Model preflight passed.\n');
    return;
  }

  process.stderr.write('Model preflight failed:\n');
  for (const error of result.errors) {
    process.stderr.write(`- ${error.message}\n`);
  }
  process.exitCode = 1;
}

runAsMain(import.meta.url, () => {
  void runCli(process.argv.slice(2), process.env).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
});
