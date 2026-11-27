import { existsSync } from 'node:fs';

import { openEventLogReadOnly } from '../event-log/open.js';
import { createSystemDeps, type Deps } from '../platform/deps.js';
import { resolveFactoryPaths } from '../platform/paths.js';
import { createPosixProcessTable, type ProcessTable } from '../ports/process-table.js';
import { diskReport, measureDiskUse, renderDisk, type MeasureDisk } from '../retention/disk-usage.js';
import { isSlug } from '../run-folder/path.js';
import { listRuns, type StatusRow } from '../status/list-runs.js';
import { refuse } from './checkout.js';
import type { CommandDef } from './router.js';

/** What a test can inject into the command; the rest comes from the real system. */
export interface StatusCommandOptions {
  deps: Deps;
  processTable: ProcessTable;
  /** Measures disk use per area; tests inject a size instead of writing gigabytes. */
  measureDisk: MeasureDisk;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Time since an event in the largest whole unit: `45s`, `5m`, `2h` or `1d`. */
export function relativeTime(elapsedMs: number): string {
  const ms = Math.max(0, elapsedMs);
  if (ms >= DAY) return `${Math.floor(ms / DAY)}d`;
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)}h`;
  if (ms >= MINUTE) return `${Math.floor(ms / MINUTE)}m`;
  return `${Math.floor(ms / SECOND)}s`;
}

/** Dollars with at least two decimals and at most four, for example `0.75` or `0.004`. */
const money = (usd: number): string => usd.toFixed(4).replace(/(\.\d{2}\d*?)0+$/, '$1');

const cells = (row: StatusRow): string[] => [
  row.ticket,
  row.repo,
  row.flow,
  row.stale ? `${row.status} (stale)` : row.status,
  row.current_step ?? '-',
  row.cost_usd === undefined ? '-' : `$${money(row.cost_usd)} ${row.cost_source ?? ''}`.trimEnd(),
  `${relativeTime(row.elapsed_ms)} ago`,
];

const HEADER = ['TICKET', 'REPO', 'FLOW', 'STATUS', 'STEP', 'COST', 'LAST EVENT'];

/** A table with a header line, one line per row, in the order of `rows`. */
export function renderRows(rows: readonly StatusRow[]): string {
  const table = [HEADER, ...rows.map(cells)];
  const widths = HEADER.map((_, column) => Math.max(...table.map((line) => line[column]?.length ?? 0)));
  return table.map((line) => line.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('  ').trimEnd()).join('\n');
}

/** `factory status [ticket]`: lists active and recent runs. Reads the event log read-only and writes nothing. */
export function createStatusCommand(options: Partial<StatusCommandOptions> = {}): CommandDef {
  return {
    description: 'List active and recent runs (read-only).',
    skipGitCheck: true,
    optionalPositionals: ['ticket'],
    run: async ({ positionals }) => {
      const ticket = positionals[0];
      if (ticket !== undefined && !isSlug(ticket)) {
        throw refuse(
          'ticket_invalid',
          `The ticket "${ticket}" is not a valid ticket key. Use letters, digits, ".", "_" or "-" only.`,
          'ticket',
          'Pass the ticket key, for example `factory status FE-123`, or no ticket to list every run.',
        );
      }
      const env = process.env;
      // A home with no event log has no runs. Opening it writably would create it, so it is not opened at all.
      if (!existsSync(resolveFactoryPaths(env).dbPath)) {
        return { message: `No ${ticket === undefined ? 'runs' : `runs of ${ticket}`} recorded.`, data: { schema_version: 1, rows: [] } };
      }
      const rows = await readRows(options, ticket);
      // Disk use covers the whole home, whatever the ticket filter. Measuring reads sizes and writes nothing.
      const disk = diskReport((options.measureDisk ?? measureDiskUse)(env));
      const subject = ticket === undefined ? 'runs' : `runs of ${ticket}`;
      return {
        message: `${rows.length === 0 ? `No ${subject} recorded.` : renderRows(rows)}\n\n${renderDisk(disk)}`,
        data: { schema_version: 1, rows, disk },
      };
    },
  };
}

async function readRows(options: Partial<StatusCommandOptions>, ticket: string | undefined): Promise<StatusRow[]> {
  const reader = openEventLogReadOnly({ env: process.env });
  try {
    return await listRuns({
      reader,
      deps: options.deps ?? createSystemDeps(),
      processTable: options.processTable ?? createPosixProcessTable(),
      ...(ticket === undefined ? {} : { ticket }),
    });
  } finally {
    reader.close();
  }
}

export const statusCommand: CommandDef = createStatusCommand();
