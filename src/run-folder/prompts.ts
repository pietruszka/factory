import { join } from 'node:path';

import { collectSecretValues, redactText } from '../redaction/redact.js';
import { existingRunFolder, writeSecureFile } from './files.js';
import { assertSlug } from './path.js';

export interface SavePromptOptions {
  env: NodeJS.ProcessEnv;
  repo: string;
  ticket: string;
  step: string;
  prompt: string;
  /** Extra exact values to redact besides the secret-named environment values. */
  extraSecrets?: readonly string[];
}

/**
 * Redacts the prompt (exact secret values, then token patterns) and only then writes it to
 * `prompts/<step>.md` (mode 0600). Returns the path.
 */
export function savePrompt(options: SavePromptOptions): string {
  const { env, repo, ticket, step, prompt, extraSecrets } = options;
  assertSlug('step', step);
  const path = join(existingRunFolder(env, repo, ticket), 'prompts', `${step}.md`);
  writeSecureFile(path, redactText(prompt, collectSecretValues(env, extraSecrets)));
  return path;
}
