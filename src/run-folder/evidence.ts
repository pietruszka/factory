import { join } from 'node:path';

import { existingRunFolder, writeSecureFile } from './files.js';

export interface WriteEvidenceDiffOptions {
  env: NodeJS.ProcessEnv;
  repo: string;
  ticket: string;
  diff: string;
}

/** Writes the patch to `evidence/diff.patch` (mode 0600) and returns its path. Copies no tree. */
export function writeEvidenceDiff(options: WriteEvidenceDiffOptions): string {
  const { env, repo, ticket, diff } = options;
  const path = join(existingRunFolder(env, repo, ticket), 'evidence', 'diff.patch');
  writeSecureFile(path, diff);
  return path;
}
