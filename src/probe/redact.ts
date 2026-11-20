import { basename } from 'node:path';

const MIN_REDACTION_LENGTH = 6;
const SECRET_NAME_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL)/i;
const GIT_CONFIG_KEY_INDEX_PATTERN = /_KEY_\d+$/i;

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactText(value: string, secrets: readonly string[]): string {
  let redacted = value;
  for (const secret of secrets) {
    if (!secret) {
      continue;
    }
    redacted = redacted.replace(new RegExp(escapeForRegExp(secret), 'g'), '[REDACTED]');
  }
  return redacted;
}

function redactRecursively(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') {
    return redactText(value, secrets);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactRecursively(entry, secrets));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return Object.fromEntries(
      entries.map(([key, currentValue]) => [key, redactRecursively(currentValue, secrets)]),
    );
  }

  return value;
}

export interface RedactionInput {
  env: NodeJS.ProcessEnv;
  factoryHome: string;
  agentEmail?: string;
  agentFirstName?: string;
  agentLastName?: string;
}

function addRedactionValues(
  target: Set<string>,
  value: string,
  options: { allowShort?: boolean } = {},
): boolean {
  const allowShort = options.allowShort === true;
  if (!allowShort && value.length < MIN_REDACTION_LENGTH) {
    return false;
  }
  target.add(value);

  const jsonEscaped = JSON.stringify(value).slice(1, -1);
  if (allowShort || jsonEscaped.length >= MIN_REDACTION_LENGTH) {
    target.add(jsonEscaped);
  }
  return true;
}

function isSecretEnvName(name: string): boolean {
  return SECRET_NAME_PATTERN.test(name) && !GIT_CONFIG_KEY_INDEX_PATTERN.test(name);
}

export interface RedactionBuildResult {
  values: string[];
  skippedEnvNames: string[];
}

export function buildRedactionValues(input: RedactionInput): RedactionBuildResult {
  const redactions = new Set<string>();
  const skippedEnvNames: string[] = [];
  const homePath = input.env.HOME;
  if (homePath) {
    addRedactionValues(redactions, homePath);
    addRedactionValues(redactions, basename(homePath));
  }
  addRedactionValues(redactions, input.factoryHome);

  const userName = input.env.USER ?? input.env.LOGNAME;
  if (userName) {
    addRedactionValues(redactions, userName);
  }

  if (input.agentEmail) {
    addRedactionValues(redactions, input.agentEmail);
  }
  if (input.agentFirstName) {
    addRedactionValues(redactions, input.agentFirstName, { allowShort: true });
  }
  if (input.agentLastName) {
    addRedactionValues(redactions, input.agentLastName, { allowShort: true });
  }

  for (const [name, value] of Object.entries(input.env)) {
    if (!value) {
      continue;
    }
    if (isSecretEnvName(name)) {
      if (!addRedactionValues(redactions, value)) {
        skippedEnvNames.push(name);
      }
    }
  }

  return {
    values: [...redactions].sort((left, right) => right.length - left.length),
    skippedEnvNames: [...new Set(skippedEnvNames)].sort(),
  };
}

export function redactProbeValue<T>(value: T, secrets: readonly string[]): T {
  return redactRecursively(value, secrets) as T;
}
