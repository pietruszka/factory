import { FactoryError } from '../platform/errors.js';

type Path = ReadonlyArray<string | number>;

const SECRET_KEY = /TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL|API[_-]?KEY/i;

// A known token prefix at the start of a word, or a PEM private-key header, anywhere in a string.
const SECRET_VALUE =
  /(?:^|[^A-Za-z0-9])(?:ghp_|gho_|ghu_|ghs_|github_pat_|sk-|AKIA|xoxb-|xoxp-|xoxa-)[A-Za-z0-9_-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/**
 * The `secrets` map holds names of environment variables and keychain items, never values.
 * Its own key and the entry names directly under it are exempt from the key-name check.
 */
const isSecretsMapName = (path: Path, key: string): boolean =>
  (path.length === 0 && key === 'secrets') || (path.length === 1 && path[0] === 'secrets');

function findSecret(value: unknown, path: Path): { path: Path; kind: 'key' | 'value' } | undefined {
  if (typeof value === 'string') {
    return SECRET_VALUE.test(value) ? { path, kind: 'value' } : undefined;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const hit = findSecret(item, [...path, index]);
      if (hit) {
        return hit;
      }
    }
    return undefined;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      const keyPath = [...path, key];
      if (!isSecretsMapName(path, key) && SECRET_KEY.test(key)) {
        return { path: keyPath, kind: 'key' };
      }
      const hit = findSecret(item, keyPath);
      if (hit) {
        return hit;
      }
    }
  }
  return undefined;
}

/**
 * Refuses config that looks like it holds a secret: a key named like one (except the `secrets` map)
 * or a string value with a known token prefix or a private-key header. Never echoes the value.
 */
export function assertNoSecrets(input: { file: string; value: unknown; lineOf: (path: Path) => number }): void {
  const hit = findSecret(input.value, []);
  if (!hit) {
    return;
  }
  const key = hit.path.join('.');
  throw new FactoryError({
    code: 'config_secret',
    message:
      hit.kind === 'key'
        ? `The key "${key}" is named like a secret. Config files never hold secrets.`
        : `The value of "${key}" looks like a token or private key. Config files never hold secrets.`,
    where: `${input.file}:${input.lineOf(hit.path)}`,
    next: 'Remove it. Keep the secret in an environment variable or the keychain, and name it under secrets (env: NAME or keychain: item-name).',
    exitCode: 2,
  });
}
