import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { createFakePlatform, type Platform } from '../../src/ports/platform.js';
import { createFakeProcessTable, type ProcessTable } from '../../src/ports/process-table.js';
import { createFakeSpawner, type Spawner } from '../../src/ports/spawner.js';
import { createRecordingCodeHost, type CodeHost } from '../../src/ports/code-host.js';
import { createRecordingTicketSource, type TicketSource } from '../../src/ports/ticket-source.js';
import { findPortOffenders } from '../support/port-scan.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** Files that implement the ports, and so may name the outside tools. */
const PORT_FILES_PREFIX = 'src/ports/';

/** Existing spawn sites that stay as they are: probe and preflight start worker CLIs for checks. */
const EXISTING_SITES = [
  'src/config/load.ts',
  'src/worktree/git.ts',
  'src/worktree/install.ts',
  'src/preflight/models.ts',
  'src/probe/probe.ts',
  'src/probe/runners.ts',
  'src/cli/version-check.ts',
];

function readSrc(): Record<string, string> {
  const root = join(repoRoot, 'src');
  return Object.fromEntries(
    readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.ts'))
      .map((name) => join(root, name))
      .map((file) => [relative(repoRoot, file).split('\\').join('/'), readFileSync(file, 'utf8')]),
  );
}

const portFiles = (sources: Record<string, string>): string[] =>
  Object.keys(sources).filter((path) => path.startsWith(PORT_FILES_PREFIX));

describe('the public port types', () => {
  test('TicketSource, CodeHost, Spawner, ProcessTable and Platform are the public types other modules import', () => {
    const ticketSource: TicketSource = createRecordingTicketSource({ tickets: {} });
    const codeHost: CodeHost = createRecordingCodeHost({});
    const spawner: Spawner = createFakeSpawner();
    const processTable: ProcessTable = createFakeProcessTable();
    const platform: Platform = createFakePlatform();

    expect(typeof ticketSource.fetchTicket).toBe('function');
    expect(typeof codeHost.fetchPullRequest).toBe('function');
    expect(typeof codeHost.push).toBe('function');
    expect(typeof codeHost.openDraftPr).toBe('function');
    expect(typeof spawner.spawn).toBe('function');
    expect(typeof spawner.killTree).toBe('function');
    expect(typeof processTable.stillMatches).toBe('function');
    expect(typeof platform.keychain.get).toBe('function');
    expect(typeof platform.clipboard.read).toBe('function');
  });
});

describe('the outside-tool scan', () => {
  // Snippets are built at runtime so this file never contains a forbidden call itself.
  const call = (fn: string, name: string, args: string[] = []): string =>
    `${fn}(${JSON.stringify(name)}, ${JSON.stringify(args)});`;

  const FORBIDDEN: Array<[string, string]> = [
    ['gh', call('spawnSync', 'gh', ['pr', 'list'])],
    ['acli', call('execFileSync', 'acli', ['jira', 'workitem', 'view'])],
    ['security', call('spawn', 'security', ['find-generic-password', '-s', 'item'])],
    ['pbcopy', call('spawn', 'pbcopy')],
    ['pbpaste', call('execFile', 'pbpaste')],
    ['agent', call('spawn', 'agent', ['--print'])],
    ['cursor-agent', call('spawn', 'cursor-agent', ['--print'])],
    ['opencode', call('spawn', 'opencode', ['run'])],
    ['copilot', call('spawn', 'copilot', ['-p'])],
  ];

  test.each(FORBIDDEN)(
    'a static scan of src fails when a file outside the port implementations calls %s',
    (_name, source) => {
      const sources = { 'src/intake/fetch.ts': source };

      expect(findPortOffenders(sources, [])).toEqual(['src/intake/fetch.ts']);
    },
  );

  test('a static scan of src fails when a file outside the port implementations calls gh, acli, security, pbcopy, pbpaste, or spawns a worker CLI', () => {
    const sources = {
      'src/intake/a.ts': FORBIDDEN[0]![1],
      'src/intake/b.ts': FORBIDDEN[2]![1],
      'src/intake/c.ts': FORBIDDEN[5]![1],
      'src/ports/platform.ts': FORBIDDEN[3]![1],
    };

    expect(findPortOffenders(sources, ['src/ports/platform.ts'])).toEqual([
      'src/intake/a.ts',
      'src/intake/b.ts',
      'src/intake/c.ts',
    ]);
  });

  test('the scan still allows the existing git, install, preflight, probe and version-check spawn sites named in this plan', () => {
    const sources = readSrc();

    expect(Object.keys(sources).length).toBeGreaterThan(0);
    expect(findPortOffenders(sources, [...portFiles(sources), ...EXISTING_SITES])).toEqual([]);
  });

  describe('imports of outside tools', () => {
    // Built at runtime so this file never contains a forbidden import itself.
    const importStyles: Array<[string, (spec: string) => string]> = [
      ['import … from', (spec) => `import run from ${JSON.stringify(spec)};`],
      ['side-effect import', (spec) => `import ${JSON.stringify(spec)};`],
      ['import()', (spec) => `const m = await import(${JSON.stringify(spec)});`],
      ['require()', (spec) => `const m = require(${JSON.stringify(spec)});`],
    ];

    test.each(importStyles)('a file outside the port implementations is flagged for %s of gh', (_name, make) => {
      const sources = { 'src/intake/fetch.ts': make('gh') };

      expect(findPortOffenders(sources, [])).toEqual(['src/intake/fetch.ts']);
    });

    test.each(['acli', 'pbcopy', 'pbpaste', 'agent', 'cursor-agent', 'opencode', 'copilot', 'gh/lib'])(
      'a file outside the port implementations is flagged for importing %s',
      (spec) => {
        const sources = { 'src/intake/fetch.ts': `import run from ${JSON.stringify(spec)};` };

        expect(findPortOffenders(sources, [])).toEqual(['src/intake/fetch.ts']);
      },
    );

    test('a port implementation file may import an outside tool', () => {
      const sources = { 'src/ports/platform.ts': importStyles[0]![1]('pbcopy') };

      expect(findPortOffenders(sources, ['src/ports/platform.ts'])).toEqual([]);
    });

    test('relative imports, comments and unrelated packages are not flagged', () => {
      const sources = {
        'src/a.ts': `import run from './gh';\nimport x from '../acli/index.js';`,
        'src/b.ts': `// we used to call gh and acli here\nconst note = 'agent';`,
        'src/c.ts': `import a from 'agenter';\nimport b from 'github';\nimport c from 'octokit';`,
      };

      expect(findPortOffenders(sources, [])).toEqual([]);
    });
  });

  test('spawning git is not flagged', () => {
    const sources = { 'src/worktree/other.ts': call('spawnSync', 'git', ['status']) };

    expect(findPortOffenders(sources, [])).toEqual([]);
  });
});
