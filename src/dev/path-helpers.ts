import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';

function normalizeForPlatform(pathValue: string): string {
  return process.platform === 'darwin' ? pathValue.toLowerCase() : pathValue;
}

export function resolveComparablePath(pathValue: string): string {
  const absolutePath = resolve(pathValue);

  let existingPrefix = absolutePath;
  while (!existsSync(existingPrefix)) {
    const parent = dirname(existingPrefix);
    if (parent === existingPrefix) {
      break;
    }
    existingPrefix = parent;
  }

  const resolvedPrefix = existsSync(existingPrefix)
    ? realpathSync.native(existingPrefix)
    : existingPrefix;
  const suffix = relative(existingPrefix, absolutePath);
  const comparablePath = suffix === '' ? resolvedPrefix : resolve(resolvedPrefix, suffix);
  return normalizeForPlatform(comparablePath);
}

export function resolveUserHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.HOME;
  return configured ? resolve(configured) : homedir();
}
