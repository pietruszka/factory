import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { resolveFactoryPaths } from '../platform/paths.js';
import { isWithinOrSamePath } from '../platform/path-helpers.js';

/** Soft warning threshold for the factory home: 10 GiB (NFR-17). It never refuses anything. */
export const DISK_WARNING_BYTES = 10 * 1024 ** 3;

/** Bytes per area, and the total of the factory home and cache root. */
export interface DiskUse {
  worktrees: number;
  runs: number;
  db: number;
  total: number;
}

/** Disk use as `factory status` and `factory clean` report it: the areas, plus a warning above the threshold. */
export interface DiskReport extends DiskUse {
  warning?: string;
}

/** Measures disk use under the resolved factory roots. Read-only. */
export type MeasureDisk = (env: NodeJS.ProcessEnv) => DiskUse;

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const;

/** Bytes in the largest fitting binary unit: `512 B`, `4.0 KiB`, `11.0 GiB`. */
function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${UNITS[unit]}`;
}

/**
 * Bytes of the regular files below `path` (a file counts as its own size). A symlink counts as the link
 * itself and is never followed, so nothing outside the roots is measured. Anything unreadable counts as 0.
 */
function sizeOf(path: string): number {
  try {
    const stat = lstatSync(path);
    if (!stat.isDirectory()) return stat.size;
    return readdirSync(path).reduce((sum, name) => sum + sizeOf(join(path, name)), 0);
  } catch {
    return 0;
  }
}

/** Worktrees, run folders and the event log (with its WAL and SHM files), and the total of the home and cache root. */
export const measureDiskUse: MeasureDisk = (env) => {
  const { home, cacheRoot, worktreesRoot, runsRoot, dbPath } = resolveFactoryPaths(env);
  const cacheInsideHome = isWithinOrSamePath(home, cacheRoot);
  return {
    worktrees: sizeOf(worktreesRoot),
    runs: sizeOf(runsRoot),
    db: [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].reduce((sum, file) => sum + sizeOf(file), 0),
    total: sizeOf(home) + (cacheInsideHome ? 0 : sizeOf(cacheRoot)),
  };
};

/** The warning text for a total above `DISK_WARNING_BYTES`, or undefined at or below it. */
export function diskWarning(totalBytes: number): string | undefined {
  if (totalBytes <= DISK_WARNING_BYTES) return undefined;
  return `The factory home uses ${formatBytes(totalBytes)}, above the 10 GiB soft limit. Nothing is refused; run \`factory clean\` to apply the retention policy.`;
}

/** The measured areas and, when the total is above 10 GiB, a warning. */
export function diskReport(use: DiskUse): DiskReport {
  const warning = diskWarning(use.total);
  return { worktrees: use.worktrees, runs: use.runs, db: use.db, total: use.total, ...(warning === undefined ? {} : { warning }) };
}

/** Text lines for a report: one line of areas, and the warning line when there is one. */
export function renderDisk(report: DiskReport): string {
  const areas = `Disk use: worktrees ${formatBytes(report.worktrees)}, runs ${formatBytes(report.runs)}, db ${formatBytes(report.db)} (total ${formatBytes(report.total)})`;
  return report.warning === undefined ? areas : `${areas}\nWarning: ${report.warning}`;
}
