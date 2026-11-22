import { describe, expect, test } from 'vitest';

import { createSystemDeps } from '../../src/platform/deps.js';
import { createFakeDeps } from '../support/fake-deps.js';

describe('system deps', () => {
  test('createSystemDeps().now() returns a number close to real time', () => {
    const before = Date.now();
    const value = createSystemDeps().now();
    const after = Date.now();

    expect(value).toBeGreaterThanOrEqual(before - 50);
    expect(value).toBeLessThanOrEqual(after + 50);
  });

  test('system random() returns a number in [0, 1) that is not constant', () => {
    const deps = createSystemDeps();
    const values = new Set(Array.from({ length: 20 }, () => deps.random()));

    expect([...values].every((v) => v >= 0 && v < 1)).toBe(true);
    expect(values.size).toBeGreaterThan(1);
  });

  test('system newId(prefix) gives unique ids that start with the prefix', () => {
    const deps = createSystemDeps();
    const first = deps.newId('r');
    const second = deps.newId('r');

    expect(first.startsWith('r_')).toBe(true);
    expect(first).not.toBe(second);
  });

  test('system setTimer fires the callback and clearTimer cancels it', async () => {
    const deps = createSystemDeps();
    const fired: string[] = [];

    deps.setTimer(() => fired.push('kept'), 5);
    const cancelled = deps.setTimer(() => fired.push('cancelled'), 5);
    deps.clearTimer(cancelled);
    await deps.sleep(40);

    expect(fired).toEqual(['kept']);
  });
});

describe('fake deps', () => {
  test('advance(1000) moves now() by 1000 and fires a timer due at 1000 but not one due at 1001', () => {
    const deps = createFakeDeps({ start: 5000 });
    const fired: number[] = [];
    deps.setTimer(() => fired.push(1000), 1000);
    deps.setTimer(() => fired.push(1001), 1001);

    deps.advance(1000);

    expect(deps.now()).toBe(6000);
    expect(fired).toEqual([1000]);
  });

  test("newId('r') from fake deps gives r_0001, r_0002", () => {
    const deps = createFakeDeps();

    expect([deps.newId('r'), deps.newId('r')]).toEqual(['r_0001', 'r_0002']);
  });

  test('fake random() is repeatable for the same seed', () => {
    const a = createFakeDeps({ seed: 7 });
    const b = createFakeDeps({ seed: 7 });

    expect([a.random(), a.random()]).toEqual([b.random(), b.random()]);
  });
});
