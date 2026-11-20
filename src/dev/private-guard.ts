import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { resolveComparablePath, resolveUserHome } from './path-helpers.js';

export function isWithinOrSamePath(basePath: string, candidatePath: string): boolean {
  const rel = relative(basePath, candidatePath);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function assertNotPrivatePath(
  candidatePath: string,
  currentHome: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const resolvedCandidate = resolveComparablePath(candidatePath);
  const resolvedCurrentHome = resolve(currentHome);
  const userHome = resolveUserHome(env);

  const forbiddenRoots = [
    resolve(userHome, '.factory-private'),
    resolve(dirname(resolvedCurrentHome), `${basename(resolvedCurrentHome)}-private`),
  ].map(resolveComparablePath);

  for (const forbiddenRoot of forbiddenRoots) {
    if (isWithinOrSamePath(forbiddenRoot, resolvedCandidate)) {
      throw new Error(`Path is inside a private directory: ${forbiddenRoot}`);
    }
  }
}
