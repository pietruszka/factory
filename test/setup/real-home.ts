import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';

// Records the real user home before any test runs, and before HOME is overridden below.
// resolveFactoryPaths (src/platform/paths.ts) reads this key and throws real_home_in_test
// when a test resolves paths with HOME set to it.
const REAL_HOME_KEY = Symbol.for('factory.realHome');
const store = globalThis as Record<symbol, unknown>;

function detectRealHome(): string {
  const fromEnv = homedir();
  return fromEnv !== '' ? fromEnv : userInfo().homedir;
}

if (store[REAL_HOME_KEY] === undefined) {
  store[REAL_HOME_KEY] = detectRealHome();
}

// Every test runs with HOME and USERPROFILE pointing at its own empty temp folder.
let previous: { HOME: string | undefined; USERPROFILE: string | undefined } | undefined;
let tempHome: string | undefined;

function restore(key: 'HOME' | 'USERPROFILE', value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

beforeEach(() => {
  previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  tempHome = realpathSync.native(mkdtempSync(join(tmpdir(), 'factory-test-home-')));
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
});

afterEach(() => {
  if (previous) {
    restore('HOME', previous.HOME);
    restore('USERPROFILE', previous.USERPROFILE);
    previous = undefined;
  }
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  }
});
