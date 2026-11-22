import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { sep } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';

// Captured at import time, before the first per-test hook runs.
const homeBeforeAnyTest = process.env.HOME;
const userProfileBeforeAnyTest = process.env.USERPROFILE;
const REAL_HOME_KEY = Symbol.for('factory.realHome');
const recordedRealHome = (): unknown => (globalThis as Record<symbol, unknown>)[REAL_HOME_KEY];

const seen: string[] = [];

describe('every test runs with a fresh temp HOME', () => {
  test('each test runs with HOME set to a fresh temp folder, different from the real home and from the previous test\'s', () => {
    const home = process.env.HOME as string;

    expect(home.startsWith(realpathSync(tmpdir()) + sep) || home.startsWith(tmpdir() + sep)).toBe(true);
    expect(home).not.toBe(recordedRealHome());
    expect(home).not.toBe(userInfo().homedir);
    expect(existsSync(home)).toBe(true);
    expect(readdirSync(home)).toEqual([]);
    seen.push(home);
  });

  test('the next test gets another folder, and the previous one is removed', () => {
    const home = process.env.HOME as string;

    expect(seen).toHaveLength(1);
    expect(home).not.toBe(seen[0]);
    expect(existsSync(seen[0] as string)).toBe(false);
  });

  test('USERPROFILE points at the same folder as HOME', () => {
    expect(process.env.USERPROFILE).toBe(process.env.HOME);
  });

  test('the real home is recorded before the override and is not the temp HOME', () => {
    const recorded = recordedRealHome();

    expect(typeof recorded).toBe('string');
    expect(recorded).toBe(userInfo().homedir);
    expect(recorded).not.toBe(process.env.HOME);
  });

  afterAll(() => {
    // After the last per-test hook: the values from before any test are back.
    expect(process.env.HOME).toBe(homeBeforeAnyTest);
    expect(process.env.USERPROFILE).toBe(userProfileBeforeAnyTest);
  });
});
