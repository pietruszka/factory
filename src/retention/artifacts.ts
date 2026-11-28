import { lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { join, relative } from 'node:path';

import { FactoryError } from '../platform/errors.js';
import { resolveFactoryPaths } from '../platform/paths.js';
import { runFolderPath } from '../run-folder/path.js';
import { realPathInside } from './confine.js';
import type { ApplyRetentionOptions, RetentionArtifacts } from './clean.js';
import { isOlderThan, type RetentionRun } from './worktrees.js';

/** Large artifacts go more than this long after the run ended (ADR-014). */
const ARTIFACT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** What goes from a run folder: the ticket snapshot, the prompts and the evidence (diff, gate logs, ...). */
const ARTIFACTS = ['ticket.json', 'prompts', 'evidence'] as const;

/**
 * Removes `path` and everything under it, returning the files, links and empty directories removed (relative to
 * `base`). A symlink is removed as a link and never followed, so its target stays. A missing path is nothing to do.
 */
function removeEntry(path: string, base: string, removed: string[]): void {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined) return;
  if (stat.isDirectory()) {
    const names = readdirSync(path);
    for (const name of names) removeEntry(join(path, name), base, removed);
    rmdirSync(path);
    // A directory that held nothing has no file to stand for it, so its own path is recorded.
    if (names.length === 0) removed.push(relative(base, path));
    return;
  }
  unlinkSync(path);
  removed.push(relative(base, path));
}

/**
 * The run's real folder when it lies inside the real runs root, with every symlink on the way followed; undefined
 * for a name that is not a slug, a folder that is missing, or one that leaves the root through a link.
 */
function runFolderOf(env: NodeJS.ProcessEnv, run: RetentionRun): string | undefined {
  try {
    return realPathInside(resolveFactoryPaths(env).runsRoot, runFolderPath(env, run.repo, run.ticket));
  } catch (error) {
    if (error instanceof FactoryError) return undefined;
    throw error;
  }
}

/**
 * Deletes `ticket.json`, `prompts/` and `evidence/` of a run that ended more than 30 days ago, and records one
 * `retention_cleaned` event that lists the paths. Everything else in the run folder, and every event row, stays.
 * A run with no `ended_at` is never cleaned. Returns undefined when nothing was removed (no event then).
 */
export function retainArtifacts(options: ApplyRetentionOptions, run: RetentionRun): RetentionArtifacts | undefined {
  const { env, deps, log } = options;
  if (run.ended_at === null || !isOlderThan(run.ended_at, deps.now(), ARTIFACT_AGE_MS)) return undefined;
  const folder = runFolderOf(env, run);
  if (folder === undefined) return undefined;

  const removed: string[] = [];
  try {
    for (const name of ARTIFACTS) removeEntry(join(folder, name), folder, removed);
  } finally {
    // Whatever was removed is recorded, even when a later removal failed.
    if (removed.length > 0) {
      log.appendEvent({ run_id: run.run_id, type: 'retention_cleaned', payload: { run_folder: folder, paths: removed.sort() } });
    }
  }
  return removed.length === 0 ? undefined : { run_id: run.run_id, paths: removed };
}
