import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { runFolderInvalid, runFolderPath } from './path.js';

export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;

/** The run folder of a run, which must already exist (see `createRunFolder`). */
export function existingRunFolder(env: NodeJS.ProcessEnv, repo: string, ticket: string): string {
  const folder = runFolderPath(env, repo, ticket);
  if (!existsSync(folder)) {
    throw runFolderInvalid(
      `The run folder ${folder} does not exist.`,
      folder,
      'Create it first with createRunFolder, then write into it.',
    );
  }
  return folder;
}

/** Writes `content` to `path` and sets mode 0600, also when the file already existed. */
export function writeSecureFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  writeFileSync(path, content, { mode: FILE_MODE });
  chmodSync(path, FILE_MODE);
}
