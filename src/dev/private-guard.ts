import { resolve } from 'node:path';

import {
  isWithinOrSamePath,
  privateSiblingOf,
  resolveComparablePath,
  resolveUserHome,
} from '../platform/path-helpers.js';

export { isWithinOrSamePath };

export function assertNotPrivatePath(
  candidatePath: string,
  currentHome: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const resolvedCandidate = resolveComparablePath(candidatePath);
  const userHome = resolveUserHome(env);

  const forbiddenRoots = [
    resolve(userHome, '.factory-private'),
    privateSiblingOf(currentHome),
  ].map((root) => resolveComparablePath(root));

  for (const forbiddenRoot of forbiddenRoots) {
    if (isWithinOrSamePath(forbiddenRoot, resolvedCandidate)) {
      throw new Error(`Path is inside a private directory: ${forbiddenRoot}`);
    }
  }
}
