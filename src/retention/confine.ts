import { existsSync, realpathSync } from 'node:fs';

import { isWithinOrSamePath } from '../platform/path-helpers.js';

/**
 * The real path of `path` (every symlink followed, including ancestors) when it lies strictly inside the real
 * `root`; undefined when it escapes, is the root itself, or does not exist. Retention deletes this path, never
 * the lexical one, so a link under the root cannot lead a delete outside it.
 */
export function realPathInside(root: string, path: string): string | undefined {
  if (!existsSync(root)) return undefined;
  try {
    const realRoot = realpathSync.native(root);
    const real = realpathSync.native(path);
    return real !== realRoot && isWithinOrSamePath(realRoot, real) ? real : undefined;
  } catch {
    return undefined;
  }
}
