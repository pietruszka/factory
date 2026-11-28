import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { writeSecureFile } from './files.js';
import { runFolderPath } from './path.js';

/** What the pipeline records about itself in the run folder's `plan.md`. */
interface PlanProgress {
  currentStep: string;
  doneSteps: readonly string[];
  lastResult: string;
}

export interface WriteProgressOptions {
  env: NodeJS.ProcessEnv;
  repo: string;
  ticket: string;
  progress: PlanProgress;
}

const BEGIN = '<!-- factory:progress:begin -->';
const END = '<!-- factory:progress:end -->';
const PLAN_FILE = 'plan.md';

/** The section, including both markers, with no newline after the end marker. */
function renderSection({ currentStep, doneSteps, lastResult }: PlanProgress): string {
  const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
  return [
    BEGIN,
    '## Pipeline progress',
    '',
    `- Current step: ${oneLine(currentStep)}`,
    `- Done steps: ${doneSteps.length === 0 ? 'none' : doneSteps.map(oneLine).join(', ')}`,
    `- Last result: ${oneLine(lastResult)}`,
    END,
  ].join('\n');
}

const SECTION_PATTERN = new RegExp(`\\n?${BEGIN}[\\s\\S]*?${END}\\n?`, 'g');

/**
 * The plan text with the progress section removed: what a person approves. The section sits between two
 * HTML comment markers at the end of the file; the one newline that separates it from the plan goes with it.
 */
export function approvedContent(markdown: string): string {
  return markdown.replace(SECTION_PATTERN, (match) => (match.startsWith('\n') && match.endsWith('\n') ? '\n' : ''));
}

/** The sha256 (hex) of `approvedContent(markdown)`. A change to the progress section never changes it. */
export function approvalHash(markdown: string): string {
  return createHash('sha256').update(approvedContent(markdown), 'utf8').digest('hex');
}

/**
 * Writes or replaces the progress section of the run folder's `plan.md` (mode 0600) and leaves the rest of
 * the file as it was. A missing `plan.md` is created holding only the section.
 */
export function writeProgress({ env, repo, ticket, progress }: WriteProgressOptions): void {
  const path = join(runFolderPath(env, repo, ticket), PLAN_FILE);
  const plan = approvedContent(existsSync(path) ? readFileSync(path, 'utf8') : '');
  const section = renderSection(progress);
  writeSecureFile(path, plan === '' ? section : `${plan}\n${section}`);
}
