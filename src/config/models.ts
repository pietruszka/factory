import { z } from 'zod';

export const MODEL_ROLES = ['planner', 'builder', 'reviewer', 'visionJudge'] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

export const ModelRoleConfigSchema = z.strictObject({
  cli: z.string().min(1).nullable(),
  model: z.string().min(1),
  family: z.string().min(1),
  temporary: z.boolean().optional(),
  note: z.string().min(1).optional(),
});

export const CompleteModelsSectionSchema = z.strictObject({
  planner: ModelRoleConfigSchema,
  builder: ModelRoleConfigSchema,
  reviewer: ModelRoleConfigSchema,
  visionJudge: ModelRoleConfigSchema,
});

export const ModelsSectionSchema = CompleteModelsSectionSchema.partial().default({});

export type ModelRoleConfig = z.infer<typeof ModelRoleConfigSchema>;
export type ModelsSection = z.infer<typeof ModelsSectionSchema>;
export type CompleteModelsSection = z.infer<typeof CompleteModelsSectionSchema>;

export const DEFAULT_MODELS: CompleteModelsSection = {
  planner: {
    cli: 'cursor-agent',
    model: 'gpt-5.3-codex-high',
    family: 'gpt',
  },
  builder: {
    cli: 'cursor-agent',
    model: 'gpt-5.3-codex-high',
    family: 'gpt',
  },
  reviewer: {
    cli: 'cursor-agent',
    model: 'claude-opus-5-5-high',
    family: 'claude',
    temporary: true,
    note: 'TEMPORARY per D-37 until the Copilot CLI follow-up passes.',
  },
  visionJudge: {
    cli: null,
    model: 'claude-opus-5-5-high',
    family: 'claude',
    note: 'Cursor agent has no headless image input yet (see docs/reference/cli-facts.md).',
  },
};

function quoteYamlString(value: string): string {
  return JSON.stringify(value);
}

function renderModelRole(name: ModelRole, config: ModelRoleConfig): string[] {
  const lines = [`  ${name}:`];
  lines.push(`    cli: ${config.cli === null ? 'null' : quoteYamlString(config.cli)}`);
  lines.push(`    model: ${quoteYamlString(config.model)}`);
  lines.push(`    family: ${quoteYamlString(config.family)}`);
  if (config.temporary !== undefined) {
    lines.push(`    temporary: ${config.temporary ? 'true' : 'false'}`);
  }
  if (config.note !== undefined) {
    lines.push(`    note: ${quoteYamlString(config.note)}`);
  }
  return lines;
}

export function renderModelsSectionYaml(models: CompleteModelsSection = DEFAULT_MODELS): string {
  return ['models:', ...MODEL_ROLES.flatMap((role) => renderModelRole(role, models[role]))].join('\n');
}
