import type { ProcessTable } from '../ports/process-table.js';
import type { Spawner } from '../ports/spawner.js';
import { readRun, type RunStateContext, type RunStatus } from '../run-state/context.js';
import { PHASES, transition } from '../run-state/transition.js';

export interface KillRunOptions extends RunStateContext {
  runId: string;
  spawner: Spawner;
  processTable: ProcessTable;
  /** Wait after the polite stop before SIGKILL, in ms. Defaults to 10 000. */
  graceMs?: number;
}

type TreeResult = 'killed' | 'pid_reused' | 'gone';

interface KilledProcess {
  pid: number;
  /** What the polite stop (`termTree`) reported. */
  term: TreeResult;
  /** What `killTree` reported, or null when the tree was already gone after the grace. */
  kill: TreeResult | null;
}

export interface KillRunResult {
  runId: string;
  /** The status the run had before the kill. */
  previousStatus: RunStatus;
  processes: KilledProcess[];
}

/** The FR-31 estimate for how long a worker gets to stop on its own. */
const DEFAULT_GRACE_MS = 10_000;
/** How often the grace wait looks again at whether the trees are gone. */
const POLL_MS = 50;

interface OpenProcess {
  id: number;
  pid: number;
  command: string;
}

const openProcesses = ({ reader }: RunStateContext, runId: string): OpenProcess[] =>
  reader
    .query('SELECT id, pid, command FROM processes WHERE run_id = ? AND ended_at IS NULL ORDER BY id', runId)
    .map((row) => ({ id: Number(row.id), pid: Number(row.pid), command: String(row.command) }));

const stillRunning = async (processTable: ProcessTable, rows: OpenProcess[]): Promise<OpenProcess[]> => {
  const alive: OpenProcess[] = [];
  for (const row of rows) {
    if (await processTable.stillMatches(row.pid, row.command)) alive.push(row);
  }
  return alive;
};

/** Waits until none of `rows` still runs its command, or `graceMs` has passed; returns the ones that still do. */
async function waitForExit(
  { deps }: RunStateContext,
  processTable: ProcessTable,
  rows: OpenProcess[],
  graceMs: number,
): Promise<OpenProcess[]> {
  const deadline = deps.now() + graceMs;
  let alive = rows;
  for (;;) {
    alive = await stillRunning(processTable, alive);
    const remaining = deadline - deps.now();
    if (alive.length === 0 || remaining <= 0) return alive;
    await deps.sleep(Math.min(POLL_MS, remaining));
  }
}

export interface StopProcessesOptions extends RunStateContext {
  runId: string;
  spawner: Spawner;
  processTable: ProcessTable;
  /** Wait after the polite stop before SIGKILL, in ms. Defaults to 10 000. */
  graceMs?: number;
}

export interface StoppedProcesses {
  /** The process rows that were open; the caller ends them. */
  rows: readonly OpenProcess[];
  processes: KilledProcess[];
}

/**
 * Gives every open process row of a run a polite stop (`termTree`), then `killTree` to the trees that still
 * run after the grace. Changes neither the run status nor the process rows: the caller ends the rows.
 */
export async function stopRunProcesses(options: StopProcessesOptions): Promise<StoppedProcesses> {
  const { runId, spawner, processTable, graceMs = DEFAULT_GRACE_MS, ...context } = options;
  const rows = openProcesses(context, runId);
  const term = new Map<number, TreeResult>();
  for (const row of rows) term.set(row.id, await spawner.termTree(row.pid, row.command));

  const stopping = rows.filter((row) => term.get(row.id) === 'killed');
  const stubborn = await waitForExit(context, processTable, stopping, graceMs);
  const kill = new Map<number, TreeResult>();
  for (const row of stubborn) kill.set(row.id, await spawner.killTree(row.pid, row.command));

  const processes = rows.map((row) => ({
    pid: row.pid,
    term: term.get(row.id) ?? 'gone',
    kill: kill.get(row.id) ?? null,
  }));
  return { rows, processes };
}

/**
 * Stops the process trees of a run and moves it to `killed`. Each recorded process gets a polite stop
 * (`termTree`); trees that still run after the grace get `killTree`. Then the run goes to `killed`
 * through `transition`, a `killed` event is appended and the process rows are ended. The worktree is
 * never touched. A run that is already `killed` is not changed again: it only stops what is still alive.
 * A run that is neither in a phase nor `killed` is refused as `illegal_transition` before anything is signalled.
 */
export async function killRun(options: KillRunOptions): Promise<KillRunResult> {
  const { runId, ...rest } = options;
  const { spawner, processTable, graceMs, ...context } = rest;
  const run = readRun(context, runId);
  if (run.status !== 'killed' && !(PHASES as readonly RunStatus[]).includes(run.status)) {
    transition(context, runId, 'killed'); // throws illegal_transition; nothing has been signalled yet
  }

  const { rows, processes } = await stopRunProcesses({ ...context, runId, spawner, processTable, graceMs });
  transition(context, runId, 'killed');
  if (run.status !== 'killed' || rows.length > 0) {
    context.log.appendEvent({ run_id: runId, type: 'killed', status: 'killed', payload: { processes } });
  }
  for (const row of rows) context.log.endProcess(row.id);
  return { runId, previousStatus: run.status, processes };
}
