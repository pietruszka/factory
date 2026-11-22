import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

function normalizeForPlatform(pathValue: string, platform: NodeJS.Platform): string {
  return platform === 'darwin' ? pathValue.toLowerCase() : pathValue;
}

/**
 * Absolute path with symlinks resolved as far as the path exists, lower-cased on macOS.
 * `platform` is injectable so case rules can be tested on any OS.
 */
export function resolveComparablePath(
  pathValue: string,
  platform: NodeJS.Platform = process.platform,
): string {
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
  return normalizeForPlatform(comparablePath, platform);
}

export function resolveUserHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.HOME;
  return configured ? resolve(configured) : homedir();
}

export function isWithinOrSamePath(basePath: string, candidatePath: string): boolean {
  const rel = relative(basePath, candidatePath);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** The private sibling of a factory home: `<home>-private` next to it (D-15). One rule, used everywhere. */
export function privateSiblingOf(factoryHome: string): string {
  const resolvedHome = resolve(factoryHome);
  return resolve(dirname(resolvedHome), `${basename(resolvedHome)}-private`);
}
