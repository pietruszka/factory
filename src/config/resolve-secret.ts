import { FactoryError } from '../platform/errors.js';
import type { Platform } from '../ports/platform.js';

export type SecretRef = { env: string } | { keychain: string };

const missing = (name: string, where: string, next: string): FactoryError =>
  new FactoryError({
    code: 'secret_missing',
    message: `The secret "${name}" has no value.`,
    where,
    next,
    exitCode: 2,
  });

/**
 * Reads a secret by name from the env object it is given, or from the keychain through the Platform.
 * Missing: `secret_missing`, exit 2. The error names the secret and where it should live, never a value.
 */
export async function resolveSecret(input: {
  env: NodeJS.ProcessEnv;
  platform: Platform;
  config: { secrets: Record<string, SecretRef> };
  name: string;
}): Promise<string> {
  const { env, platform, config, name } = input;
  const ref = config.secrets[name];
  if (!ref) {
    throw missing(name, 'secrets', `add "${name}" under secrets in the factory config, as env or keychain`);
  }
  if ('env' in ref) {
    const value = env[ref.env];
    if (!value) throw missing(name, `environment variable ${ref.env}`, `set ${ref.env} in the environment`);
    return value;
  }
  const value = await platform.keychain.get(ref.keychain);
  if (!value) {
    throw missing(name, `keychain item ${ref.keychain}`, `store the secret in the keychain item "${ref.keychain}"`);
  }
  return value;
}
