// The child process of the scripted fake worker. It plays one scenario in its working folder.
// It is not a model CLI. Started by test/support/fake-worker.ts through a Spawner.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

// Safety net: no scenario child or grandchild outlives a crashed test run by more than this.
const LIFETIME_MS = 120_000;

const scenario = JSON.parse(process.argv[2]);
const cwd = process.cwd();

/** An absolute path inside the working folder. Refuses absolute paths and `..`. */
function inside(path) {
  const absolute = resolve(cwd, path);
  if (isAbsolute(path) || relative(cwd, absolute).startsWith('..')) {
    throw new Error(`scenario path escapes the worktree: ${path}`);
  }
  return absolute;
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

for (const edit of scenario.edits ?? []) {
  const target = inside(edit.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, edit.content);
}

for (const path of scenario.deletes ?? []) {
  rmSync(inside(path), { force: true });
}

if (scenario.ignoreSigterm) {
  process.on('SIGTERM', () => {});
}

// Grandchildren stay in this process's group; killTree finds them with ps.
const grandchildren = Array.from({ length: scenario.children ?? 0 }, () => {
  const child = spawn(process.execPath, ['-e', `setTimeout(() => {}, ${LIFETIME_MS})`], { stdio: 'ignore' });
  child.unref();
  return child;
});

if (scenario.readyFile) {
  writeFileSync(inside(scenario.readyFile), 'ready\n');
}

if (scenario.latchFile) {
  const latch = inside(scenario.latchFile);
  while (!existsSync(latch)) {
    await wait(25);
  }
}

if (scenario.hang) {
  await wait(LIFETIME_MS);
  process.exit(1);
}

const output = {};
if (scenario.text !== undefined) output.text = scenario.text;
if (scenario.sessionId !== undefined) output.sessionId = scenario.sessionId;
if (scenario.usage !== undefined) output.usage = scenario.usage;
if (Object.keys(output).length > 0) {
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

for (const child of grandchildren) child.kill();
process.exit(scenario.exitCode ?? 0);
