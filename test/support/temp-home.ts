import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const created: string[] = [];

/** Fresh empty folder under the OS temp dir, returned with symlinks resolved. */
export function makeTempHome(prefix = 'factory-test-home-'): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

/** Removes every folder made by makeTempHome. Call from afterEach. */
export function cleanupTempHomes(): void {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}
