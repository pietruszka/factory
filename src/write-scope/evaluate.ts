import { matchesAnyGlob } from './glob.js';
import type { ScopeChange } from './snapshot.js';
import type { WriteScopeConfig } from './types.js';

/**
 * What each role may change in the worktree when the config has no override. `verifier` is a write-scope
 * role but not a model slot. A role that is not listed (including a name nobody has heard of) writes nothing.
 */
const DEFAULT_WRITE_GLOBS: Readonly<Record<string, readonly string[]>> = {
  planner: ['plan.md'],
  builder: ['**'],
  reviewer: [],
  visionJudge: [],
  verifier: [],
};

export interface ScopeRow {
  /** The worktree-relative path that changed. */
  item: string;
  /** False when the role may not change it. */
  ok: boolean;
}

/** The globs a role may write: a non-empty `role_write_globs` entry replaces the default as a whole. */
function writeGlobsFor(role: string, config: Pick<WriteScopeConfig, 'role_write_globs'>): readonly string[] {
  const override = (config.role_write_globs as Readonly<Record<string, readonly string[] | undefined>>)[role];
  return override !== undefined && override.length > 0 ? override : (DEFAULT_WRITE_GLOBS[role] ?? []);
}

/** One row per changed path. A path is allowed when it matches a write glob of the role and no `protected_globs` entry. */
export function evaluateChanges(role: string, config: WriteScopeConfig, changes: readonly ScopeChange[]): ScopeRow[] {
  const allowed = writeGlobsFor(role, config);
  return changes.map(({ path }) => ({
    item: path,
    ok: matchesAnyGlob(path, allowed) && !matchesAnyGlob(path, config.protected_globs),
  }));
}
