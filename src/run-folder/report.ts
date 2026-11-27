import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { MODEL_ROLES } from '../config/models.js';
import { formatUsd } from '../cost/format.js';
import type { EventLogReadOnly } from '../event-log/open.js';
import { readPayload } from '../event-log/payloads.js';
import { FactoryError } from '../platform/errors.js';
import { isWithinOrSamePath, resolveComparablePath } from '../platform/path-helpers.js';
import { resolveFactoryPaths } from '../platform/paths.js';
import { existingRunFolder, writeSecureFile } from './files.js';
import { runFolderInvalid } from './path.js';

export interface WriteReportOptions {
  env: NodeJS.ProcessEnv;
  log: EventLogReadOnly;
  runId: string;
  /** Under the cache root; recorded in the report. */
  worktreePath: string;
}

const REPORT_FILE = 'report.md';
const PLANNED_FLOW_ARTIFACTS: readonly string[] = ['plan.md', 'plan.approved', 'evidence/diff.patch', REPORT_FILE];

/** Paths a run must have before it can end as passed, per flow (NFR-23). Other flows are not defined. */
const REQUIRED_ARTIFACTS: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  ['A', PLANNED_FLOW_ARTIFACTS],
  ['E', PLANNED_FLOW_ARTIFACTS],
  ['H', PLANNED_FLOW_ARTIFACTS],
  ['F', ['review.md', REPORT_FILE]],
]);

/** Known files that are listed when present and not required. */
const OPTIONAL_FILES = ['ticket.json', 'decisions.md', 'plan.md', 'plan.approved', 'evidence/diff.patch', 'review.md'];
/** Optional directories listed when present, even if empty. */
const OPTIONAL_DIRECTORIES = ['context', 'evidence/gates', 'verify'];
/** Folders whose files are all listed when present. */
const OPTIONAL_FOLDERS = ['context', 'evidence/gates', 'verify', 'prompts'];

const COST_LABELS = ['reported', 'estimated', 'unlabelled'] as const;
const REQUIRED_LINE = /^- `([^`]+)` \(required\): (present|missing)$/;

type Row = Record<string, unknown>;

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Files below `folder`, as sorted paths relative to `root`. Symlinks are skipped. */
function listFiles(root: string, folder: string): string[] {
  try {
    return readdirSync(join(root, folder), { withFileTypes: true })
      .flatMap((entry) => {
        const path = `${folder}/${entry.name}`;
        return entry.isDirectory() ? listFiles(root, path) : entry.isFile() ? [path] : [];
      })
      .sort();
  } catch {
    return [];
  }
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function worktreeRefusal(worktreePath: string, cacheRoot: string): FactoryError {
  return runFolderInvalid(
    `The worktree path ${worktreePath} is not under the cache root ${cacheRoot}.`,
    'worktreePath',
    `Pass the absolute path of a worktree under ${cacheRoot}.`,
  );
}

/** The worktree must be an absolute path strictly inside the cache root, symlinks resolved. */
function assertWorktreeUnderCache(env: NodeJS.ProcessEnv, worktreePath: string): void {
  const { cacheRoot } = resolveFactoryPaths(env);
  const comparable = resolveComparablePath(worktreePath);
  const comparableCache = resolveComparablePath(cacheRoot);
  if (!isAbsolute(worktreePath) || comparable === comparableCache || !isWithinOrSamePath(comparableCache, comparable)) {
    throw worktreeRefusal(worktreePath, cacheRoot);
  }
}

function readRun(log: EventLogReadOnly, runId: string): Row {
  const row = log.query(
    'SELECT repo, ticket, flow, tier, base_commit, config_hash, started_at, ended_at FROM runs WHERE run_id = ?',
    runId,
  )[0];
  if (row === undefined) {
    throw new FactoryError({
      code: 'run_not_found',
      message: `There is no run ${runId} in the event log.`,
      where: runId,
      next: 'Pass the run_id of a run that was recorded in the event log.',
      exitCode: 2,
    });
  }
  return row;
}

/** Distinct role and model pairs from the steps and the events of the run. */
function modelLines(log: EventLogReadOnly, runId: string): string[] {
  const pairs = log.query(
    `SELECT role, model FROM steps WHERE run_id = ? AND model IS NOT NULL
     UNION
     SELECT role, model FROM events WHERE run_id = ? AND model IS NOT NULL
     ORDER BY role, model`,
    runId,
    runId,
  );
  const used = new Set(pairs.map((pair) => asText(pair.role)));
  return [
    ...pairs.map((pair) => `- ${asText(pair.role) ?? 'unspecified role'}: ${String(pair.model)}`),
    ...MODEL_ROLES.filter((role) => !used.has(role)).map((role) => `- ${role}: unused`),
  ];
}

/** Cost per usage source and a total when there is more than one; "missing" when none was recorded. */
function costLines(log: EventLogReadOnly, runId: string): string[] {
  const rows = log.query(
    'SELECT usage_source, SUM(cost_usd) AS total FROM events WHERE run_id = ? AND cost_usd IS NOT NULL GROUP BY usage_source',
    runId,
  );
  const bySource = COST_LABELS.flatMap((label) => {
    const row = rows.find((candidate) => (asText(candidate.usage_source) ?? 'unlabelled') === label);
    return row === undefined ? [] : [{ label, total: Number(row.total) }];
  });
  if (bySource.length === 0) {
    return ['- **Cost:** missing (no cost was recorded for this run)'];
  }
  const lines = bySource.map(({ label, total }) => `- **Cost (${label}):** ${formatUsd(total)}`);
  return bySource.length > 1
    ? [...lines, `- **Cost (total):** ${formatUsd(bySource.reduce((sum, { total }) => sum + total, 0))}`]
    : lines;
}

/** The recorded next action of a stop that is still the run's status (cap reached, cost missing); empty otherwise. */
function nextActionLines(log: EventLogReadOnly, runId: string): string[] {
  const row = log.query(
    `SELECT e.payload_json FROM events e JOIN runs r ON r.run_id = e.run_id
     WHERE e.run_id = ? AND e.type = 'run_stop' AND e.status = r.status ORDER BY e.id DESC LIMIT 1`,
    runId,
  )[0];
  const next = typeof row?.payload_json === 'string' ? readPayload(row, 'run_stop').next : undefined;
  return next === undefined ? [] : ['## Next action', '', next, ''];
}

function formatDuration(startedAt: string | undefined, endedAt: string | undefined): string {
  if (startedAt === undefined || endedAt === undefined) {
    return 'not finished (no end time recorded)';
  }
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) {
    return 'unknown (the start and end times do not form a duration)';
  }
  const seconds = Math.round(ms / 1000);
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60];
  return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function artifactLines(folder: string, flow: string): string[] {
  const required = REQUIRED_ARTIFACTS.get(flow);
  if (required === undefined) {
    return [`- No required artifacts are defined for flow "${flow}", so this run cannot pass.`];
  }
  const requiredLines = required.map(
    (path) => `- \`${path}\` (required): ${path === REPORT_FILE || isFile(join(folder, path)) ? 'present' : 'missing'}`,
  );
  const optional = [
    ...OPTIONAL_FILES.filter((path) => !required.includes(path) && isFile(join(folder, path))),
    ...OPTIONAL_DIRECTORIES.filter((path) => isDir(join(folder, path))).map((path) => `${path}/`),
    ...OPTIONAL_FOLDERS.flatMap((path) => listFiles(folder, path)),
  ].sort();
  return [...requiredLines, ...optional.map((path) => `- \`${path}\` (optional): present`)];
}

function renderReport(run: Row, flow: string, folder: string, worktreePath: string, log: EventLogReadOnly, runId: string): string {
  const hash = asText(run.config_hash) ?? '';
  return [
    `# Run report: ${String(run.ticket)}`,
    '',
    `- **Ticket:** ${String(run.ticket)}`,
    `- **Repo:** ${String(run.repo)}`,
    `- **Run id:** ${runId}`,
    '',
    '## Route',
    '',
    `- **Flow:** ${flow}`,
    `- **Tier:** ${asText(run.tier) ?? 'not recorded'}`,
    '',
    '## Config',
    '',
    `- **Config hash:** ${hash.startsWith('sha256:') ? hash : `sha256:${hash}`}`,
    '',
    '## Models',
    '',
    ...modelLines(log, runId),
    '',
    '## Cost and duration',
    '',
    ...costLines(log, runId),
    `- **Duration:** ${formatDuration(asText(run.started_at), asText(run.ended_at))}`,
    '',
    '## Workspace',
    '',
    `- **Worktree:** ${worktreePath}`,
    `- **Base commit:** ${String(run.base_commit)}`,
    '',
    '## Artifacts',
    '',
    ...artifactLines(folder, flow),
    '',
    ...nextActionLines(log, runId),
  ].join('\n');
}

/**
 * Writes `report.md` (mode 0600) into the run folder of the run and returns its path. Reads the
 * event log only: cost, duration, models, config hash and base commit come from it, and the run
 * status is never written. A missing required artifact is listed as `missing`; the report is still
 * written. The run folder must exist; `worktreePath` must be inside the cache root.
 */
export function writeReport(options: WriteReportOptions): string {
  const { env, log, runId, worktreePath } = options;
  assertWorktreeUnderCache(env, worktreePath);
  const run = readRun(log, runId);
  const folder = existingRunFolder(env, String(run.repo), String(run.ticket));
  const path = join(folder, REPORT_FILE);
  writeSecureFile(path, renderReport(run, String(run.flow), folder, worktreePath, log, runId));
  return path;
}

/**
 * True only when the report in `runFolder` records a flow with a defined required list, lists every
 * required artifact of that flow as present, and every one of them is still a file on disk. A
 * missing or unreadable report, an unknown flow, a stale `missing` entry or a deleted file gives false.
 */
export function canPassFromReport(runFolder: string): boolean {
  const reportPath = join(runFolder, REPORT_FILE);
  if (!isFile(reportPath)) {
    return false;
  }
  const text = readFileSync(reportPath, 'utf8');
  const flow = /^- \*\*Flow:\*\* (.+)$/m.exec(text)?.[1]?.trim();
  const required = flow === undefined ? undefined : REQUIRED_ARTIFACTS.get(flow);
  if (required === undefined) {
    return false;
  }
  const lines = text.split('\n');
  const start = lines.indexOf('## Artifacts');
  const section = start === -1 ? [] : lines.slice(start + 1);
  const end = section.findIndex((line) => line.startsWith('#'));
  const recorded = new Map(
    (end === -1 ? section : section.slice(0, end)).flatMap((line) => {
      const match = REQUIRED_LINE.exec(line);
      return match?.[1] === undefined ? [] : [[match[1], match[2]] as const];
    }),
  );
  return required.every((path) => recorded.get(path) === 'present' && isFile(join(runFolder, path)));
}
