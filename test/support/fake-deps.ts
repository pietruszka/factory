import type { Deps } from '../../src/platform/deps.js';

export interface FakeDeps extends Deps {
  /** Moves the clock forward and fires every timer due at or before the new time, in order. */
  advance(ms: number): void;
}

interface Timer {
  handle: number;
  dueAt: number;
  fn: () => void;
}

// mulberry32: small seeded generator, so random() is repeatable.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createFakeDeps(opts: { start?: number; seed?: number } = {}): FakeDeps {
  let current = opts.start ?? 0;
  let nextHandle = 1;
  let timers: Timer[] = [];
  const counters = new Map<string, number>();
  const random = seededRandom(opts.seed ?? 1);

  const setTimer = (fn: () => void, ms: number): number => {
    const handle = nextHandle++;
    timers.push({ handle, dueAt: current + ms, fn });
    return handle;
  };

  return {
    now: () => current,
    setTimer,
    clearTimer: (handle) => {
      timers = timers.filter((timer) => timer.handle !== handle);
    },
    sleep: (ms) => new Promise<void>((resolve) => void setTimer(resolve, ms)),
    newId: (prefix) => {
      const count = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, count);
      return `${prefix}_${String(count).padStart(4, '0')}`;
    },
    random,
    toIso: (ms) => new Date(ms).toISOString(),
    advance: (ms) => {
      const target = current + ms;
      for (;;) {
        const due = timers
          .filter((timer) => timer.dueAt <= target)
          .sort((a, b) => a.dueAt - b.dueAt || a.handle - b.handle)[0];
        if (!due) {
          break;
        }
        timers = timers.filter((timer) => timer !== due);
        current = Math.max(current, due.dueAt);
        due.fn();
      }
      current = target;
    },
  };
}
