import { isoNow, type RunStateContext } from '../run-state/context.js';
import { evaluateChanges } from './evaluate.js';
import { restorePaths } from './restore.js';
import { diffSnapshots, takeSnapshot } from './snapshot.js';
import type { WriteScopeOptions } from './types.js';

const WRITE_SCOPE_EVENT = 'write_scope';
const GATE = 'write_scope';

/** One worker attempt that is checked: where it runs and who it is. */
export interface ScopedAttempt {
  context: RunStateContext;
  runId: string;
  writeScope: WriteScopeOptions;
  /** The run's worktree. */
  cwd: string;
  role: string;
  stepId: string;
  attempt: number;
}

/** The state before the attempt: the snapshot tree and the clock time it was taken. */
export interface ScopeMark {
  tree: string;
  startedAt: string;
}

/** Snapshots the worktree before the worker starts. */
export function markBefore({ context, writeScope, cwd }: ScopedAttempt): ScopeMark {
  const startedAt = isoNow(context);
  const tree = takeSnapshot({ env: context.env, cwd, snapshotIgnore: writeScope.config.snapshot_ignore, tempDir: writeScope.tempDir });
  return { tree, startedAt };
}

/**
 * Checks what the worker changed since `mark`. Every violated path is restored from the pre-step snapshot,
 * then one `write_scope` event with a check row per changed path is logged (a clean attempt logs its rows too
 * and restores nothing). Returns true when at least one path was out of scope. The caller ends the step and
 * moves the run to `breach`.
 */
export function checkAfter(scoped: ScopedAttempt, mark: ScopeMark): boolean {
  const { context, runId, writeScope, cwd, role, stepId, attempt } = scoped;
  const { env } = context;
  const after = takeSnapshot({ env, cwd, snapshotIgnore: writeScope.config.snapshot_ignore, tempDir: writeScope.tempDir });
  const changes = diffSnapshots({ env, cwd, before: mark.tree, after });
  const rows = evaluateChanges(role, writeScope.config, changes);
  const violated = changes.filter((_, index) => rows[index]?.ok === false);
  if (violated.length > 0) {
    restorePaths({ env, cwd, tree: mark.tree, changes: violated, tempDir: writeScope.tempDir });
  }
  const { id } = context.log.appendEvent({
    run_id: runId,
    type: WRITE_SCOPE_EVENT,
    step: stepId,
    attempt,
    role,
    started_at: mark.startedAt,
    ended_at: isoNow(context),
    status: violated.length > 0 ? 'breach' : 'ok',
    payload: { changes, restored: violated.map(({ path }) => path) },
  });
  if (rows.length > 0) {
    context.log.appendCheckRows(
      id,
      rows.map(({ item, ok }) => ({ gate: GATE, item, ok })),
    );
  }
  return violated.length > 0;
}
