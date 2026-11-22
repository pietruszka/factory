import type { ProcessTable } from '../ports/process-table.js';
import type { RunStateContext } from './context.js';
import { PHASES, transition } from './transition.js';

export interface MarkStaleRunsOptions extends RunStateContext {
  processTable: ProcessTable;
}

interface RecordedProcess {
  id: number;
  runId: string;
  pid: number;
  command: string;
}

function openProcesses({ reader }: RunStateContext): RecordedProcess[] {
  const phases = PHASES.map((phase) => `'${phase}'`).join(', ');
  return reader
    .query(
      `SELECT p.id, p.run_id, p.pid, p.command FROM processes p
       JOIN runs r ON r.run_id = p.run_id
       WHERE p.ended_at IS NULL AND r.status IN (${phases})
       ORDER BY p.id`,
    )
    .map((row) => ({ id: Number(row.id), runId: String(row.run_id), pid: Number(row.pid), command: String(row.command) }));
}

/**
 * Moves every run that sits in a phase to `interrupted` when none of its recorded processes is still
 * the command it was recorded with (pid gone, or recycled by another command). Dead process rows are
 * ended. No pid is signalled. Returns the ids of the runs that were moved.
 */
export async function markStaleRuns(options: MarkStaleRunsOptions): Promise<string[]> {
  const { processTable, ...context } = options;
  const alive = new Map<string, boolean>();
  for (const child of openProcesses(context)) {
    const matches = await processTable.stillMatches(child.pid, child.command);
    if (!matches) {
      context.log.endProcess(child.id);
    }
    alive.set(child.runId, (alive.get(child.runId) ?? false) || matches);
  }
  const stale = [...alive].filter(([, hasLiveProcess]) => !hasLiveProcess).map(([runId]) => runId);
  for (const runId of stale) {
    transition(context, runId, 'interrupted');
  }
  return stale;
}
