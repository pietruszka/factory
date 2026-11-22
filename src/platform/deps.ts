import { randomUUID } from 'node:crypto';

/**
 * Clock, timers, ids and randomness behind one interface (P-14). Code outside
 * `src/platform/deps.ts` takes a `Deps` instead of touching the globals, so tests can drive time and ids.
 */
export interface Deps {
  now(): number;
  sleep(ms: number): Promise<void>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  newId(prefix: string): string;
  random(): number;
  /** ISO-8601 UTC text for a millisecond timestamp, for example from `now()`. */
  toIso(ms: number): string;
}

/** The only place allowed to read the real clock, timers and randomness (see eslint.config.js). */
export function createSystemDeps(): Deps {
  const setTimer: Deps['setTimer'] = (fn, ms) => setTimeout(fn, ms);

  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise<void>((resolve) => void setTimer(resolve, ms)),
    setTimer,
    clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
    newId: (prefix) => `${prefix}_${randomUUID()}`,
    random: () => Math.random(),
    toIso: (ms) => new Date(ms).toISOString(),
  };
}
