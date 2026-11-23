/**
 * Opt-in: `npm run test:sample-gates` unpacks the to-do sample into a fresh temp folder, installs it once
 * with the committed lockfile (needs network) and runs the sample's own gates:
 *   todo-v0: lint, typecheck and unit tests must pass.
 *   todo-v1 and todo-v2: lint and typecheck must pass, the unit tests must fail (the planted bug).
 * Never uses a real factory home or cache folder: HOME for the unpack is the temp folder.
 * Not run by `npm test` or `npm run test:l3`, because a cold install can take minutes.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import { unpackTodoSandbox } from '../src/sandbox/todo-sandbox.js';

interface Expectation {
  tag: string;
  /** Gate script name -> whether it must pass. */
  gates: Record<string, boolean>;
}

const EXPECTATIONS: readonly Expectation[] = [
  { tag: 'todo-v0', gates: { lint: true, typecheck: true, test: true } },
  { tag: 'todo-v1', gates: { lint: true, typecheck: true, test: false } },
  { tag: 'todo-v2', gates: { lint: true, typecheck: true, test: false } },
];

function run(cwd: string, command: string, args: readonly string[], quiet: boolean): { ok: boolean; output: string } {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit', env: process.env });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

export function runSampleGates(print: (line: string) => void): boolean {
  const temp = mkdtempSync(join(tmpdir(), 'sample-gates-'));
  try {
    const { path } = unpackTodoSandbox({ env: { HOME: temp, PATH: process.env.PATH }, sample: 'todo-v0' });
    print(`Sample unpacked at ${path}`);

    const installStart = performance.now();
    if (!run(path, 'npm', ['ci', '--no-audit', '--no-fund'], false).ok) {
      print('FAIL install: npm ci failed');
      return false;
    }
    print(`install: ${Math.round((performance.now() - installStart) / 1000)} s`);

    let allMet = true;
    for (const { tag, gates } of EXPECTATIONS) {
      if (!run(path, 'git', ['checkout', '--quiet', '--force', '--detach', `refs/tags/${tag}`], true).ok) {
        print(`FAIL ${tag}: checkout failed`);
        return false;
      }
      for (const [script, mustPass] of Object.entries(gates)) {
        const started = performance.now();
        const { ok, output } = run(path, 'npm', ['run', '--silent', script], true);
        const met = ok === mustPass;
        allMet &&= met;
        const seconds = ((performance.now() - started) / 1000).toFixed(1);
        print(`${met ? 'ok  ' : 'FAIL'} ${tag} ${script}: ${ok ? 'passed' : 'failed'}, expected ${mustPass ? 'pass' : 'fail'} (${seconds} s)`);
        if (!met) print(output);
      }
    }
    return allMet;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const started = performance.now();
  const met = runSampleGates(console.log);
  console.log(`${met ? 'Sample gates as expected' : 'Sample gates NOT as expected'} in ${Math.round((performance.now() - started) / 1000)} s`);
  process.exitCode = met ? 0 : 1;
}
