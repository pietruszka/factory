import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { REPO_ROOT } from '../support/todo-sandbox.js';

const RUNBOOK = join(REPO_ROOT, 'docs', 'agent-runbook.md');

/** The runbook text. A missing file fails the test that asks for it. */
function runbook(): string {
  expect(existsSync(RUNBOOK), 'docs/agent-runbook.md does not exist').toBe(true);
  return readFileSync(RUNBOOK, 'utf8');
}

/** Asserts each pattern (case-insensitive) is found, naming the missing one. */
function expectMentions(text: string, patterns: ReadonlyArray<string | RegExp>): void {
  for (const pattern of patterns) {
    const found = typeof pattern === 'string' ? text.toLowerCase().includes(pattern.toLowerCase()) : pattern.test(text);
    expect(found, `the runbook does not mention ${String(pattern)}`).toBe(true);
  }
}

describe('the agent runbook', () => {
  test('the runbook lists the allowed surfaces and the stop limits', () => {
    const text = runbook();

    // Headings an agent looks for.
    expectMentions(text, [/^#{1,3} .*allowed surfaces/im, /^#{1,3} .*failure.detection/im, /^#{1,3} .*stop limits/im]);
    // Shipped commands, as written on a command line.
    expectMentions(text, [
      'factory status',
      'factory kill',
      'factory resume',
      'factory clean',
      'factory dev-init --sample',
      'factory dev-approve',
      'factory version',
      'factory help',
    ]);
    // Machine output and exit codes (0 done, 1 needs attention, 2 refused, 3 breach, 4 internal).
    expectMentions(text, ['--json', 'exit_code', 'next_command', /exit (code )?0\b/i, /exit (code )?2\b/i, /exit (code )?4\b/i]);
    // Read-only database queries, run-folder files, the fake worker and the injectable clock.
    expectMentions(text, ['read-only', 'factory.db', 'report.md', 'plan.md', 'plan.approved', 'evidence/', 'fake worker', 'injectable clock']);
    // The five stop limits.
    expectMentions(text, [
      /three identical/i,
      /20 (factory )?commands/i,
      /one resume per cause/i,
      /one retry/i,
      'cli_error',
      /10 minutes/i,
      /factory kill/i,
      /60 minutes/i,
    ]);
    // Commands that are designed but not shipped are marked as such.
    expectMentions(text, [/not in M1/i, 'factory plan', 'factory approve']);
  });

  test('the runbook tells the agent to use a throwaway factory home and the sandbox only', () => {
    const text = runbook();

    expectMentions(text, [
      'throwaway factory home',
      '.factory-dev-home',
      'FACTORY_HOME',
      'sandbox only',
      'todo-app',
      /never .*real factory home/i,
      /private sibling/i,
      /never .*(live )?`?gh`?/i,
      /never .*`?acli`?/i,
    ]);
    // No personal path leaks into the runbook.
    expect(text).not.toMatch(/\/Users\//);
  });
});
