import type { Config } from '../config/schema.js';

/** The merged-config keys that decide what a role may change in the worktree. */
export type WriteScopeConfig = Pick<Config, 'protected_globs' | 'role_write_globs' | 'snapshot_ignore'>;

/** The optional write-scope argument of `runSteps`. When present, every step is snapshotted and checked. */
export interface WriteScopeOptions {
  config: WriteScopeConfig;
  /** A folder (outside the worktree) where the temporary index file of a snapshot lives. It is empty again after a snapshot. */
  tempDir: string;
}
