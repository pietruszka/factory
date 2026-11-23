import { afterEach, describe, expect, test } from 'vitest';

import { listRuns } from '../../src/status/list-runs.js';
import {
  cleanupStatusTest,
  DAY,
  HOUR,
  MINUTE,
  NOW,
  seedThreeRuns,
  statusFixture,
  type StatusFixture,
} from '../support/status.js';

afterEach(cleanupStatusTest);

const list = (fx: StatusFixture, ticket?: string) =>
  listRuns({ reader: fx.reader, deps: fx.deps, processTable: fx.processTable, ...(ticket === undefined ? {} : { ticket }) });

const byTicket = async (fx: StatusFixture) => Object.fromEntries((await list(fx)).map((row) => [row.ticket, row]));

describe('listRuns: active and recent runs', () => {
  test('lists the active run first, then finished runs with the newest last event first, each with ticket, repo, flow, status, current step, cost and elapsed time', async () => {
    const fx = statusFixture();
    seedThreeRuns(fx);

    const rows = await list(fx);

    expect(rows).toEqual([
      {
        run_id: 'run-123',
        ticket: 'FE-123',
        repo: 'example-frontend',
        flow: 'B',
        status: 'building',
        current_step: 'implement',
        last_event_at: '2026-03-01T11:55:00.000Z',
        elapsed_ms: 300_000,
        stale: false,
      },
      {
        run_id: 'run-101',
        ticket: 'FE-101',
        repo: 'example-frontend',
        flow: 'A',
        status: 'passed',
        current_step: 'prepare',
        cost_usd: 0.75,
        cost_source: 'reported',
        last_event_at: '2026-03-01T10:00:00.000Z',
        elapsed_ms: 7_200_000,
        stale: false,
      },
      {
        run_id: 'run-102',
        ticket: 'FE-102',
        repo: 'example-frontend',
        flow: 'C',
        status: 'budget',
        current_step: 'implement',
        cost_usd: 1.5,
        cost_source: 'estimated',
        last_event_at: '2026-02-28T12:00:00.000Z',
        elapsed_ms: 86_400_000,
        stale: false,
      },
    ]);
  });

  test('the elapsed time is measured against the clock of Deps', async () => {
    const fx = statusFixture();
    seedThreeRuns(fx);
    fx.deps.advance(MINUTE);

    const rows = await list(fx);

    expect(rows[0]?.elapsed_ms).toBe(6 * MINUTE);
    expect(rows[0]?.last_event_at).toBe('2026-03-01T11:55:00.000Z');
  });

  test('recent runs default to the last 10: an eleventh finished run is omitted while the active run is still listed', async () => {
    const fx = statusFixture();
    // FE-301 has the oldest last event (11 min ago), FE-311 the newest (1 min ago).
    for (let n = 301; n <= 311; n += 1) {
      fx.addRun({ runId: `run-${n}`, ticket: `FE-${n}`, status: 'passed', lastEventAgoMs: (312 - n) * MINUTE });
    }
    fx.addRun({ runId: 'run-123', ticket: 'FE-123', status: 'building', lastEventAgoMs: 30 * DAY, process: 'live' });

    const rows = await list(fx);

    expect(rows.map((row) => row.ticket)).toEqual([
      'FE-123',
      'FE-311',
      'FE-310',
      'FE-309',
      'FE-308',
      'FE-307',
      'FE-306',
      'FE-305',
      'FE-304',
      'FE-303',
      'FE-302',
    ]);
  });

  test('every run in a phase is listed, awaiting_approval included, even when there are more than ten', async () => {
    const fx = statusFixture();
    const phases = ['preflight', 'routing', 'planning', 'awaiting_approval', 'building', 'gating', 'verifying', 'reviewing', 'opening_pr'];
    for (let n = 0; n < 12; n += 1) {
      fx.addRun({
        runId: `run-${400 + n}`,
        ticket: `FE-${400 + n}`,
        status: phases[n % phases.length] ?? 'building',
        lastEventAgoMs: (n + 1) * MINUTE,
        process: 'live',
      });
    }
    fx.addRun({ runId: 'run-501', ticket: 'FE-501', status: 'passed', lastEventAgoMs: MINUTE });

    const rows = await list(fx);

    expect(rows).toHaveLength(13);
    expect(rows.slice(0, 12).every((row) => row.ticket !== 'FE-501')).toBe(true);
    expect(rows[12]?.ticket).toBe('FE-501');
  });

  test('current step follows the latest attempt of each step, not an older done row', async () => {
    const fx = statusFixture();
    // Steps are listed in the order they started.
    fx.addRun({
      runId: 'run-201',
      ticket: 'FE-201',
      status: 'building',
      lastEventAgoMs: MINUTE,
      process: 'live',
      steps: [
        { step: 'prepare', attempt: 1, status: 'done' },
        { step: 'implement', attempt: 1, status: 'done' },
        { step: 'prepare', attempt: 2, status: 'running' },
      ],
    });
    fx.addRun({
      runId: 'run-202',
      ticket: 'FE-202',
      status: 'building',
      lastEventAgoMs: MINUTE,
      process: 'live',
      steps: [
        { step: 'prepare', attempt: 1, status: 'done' },
        { step: 'implement', attempt: 1, status: 'done' },
      ],
    });
    fx.addRun({ runId: 'run-203', ticket: 'FE-203', status: 'building', lastEventAgoMs: MINUTE, process: 'live' });
    fx.addRun({
      runId: 'run-204',
      ticket: 'FE-204',
      status: 'building',
      lastEventAgoMs: MINUTE,
      process: 'live',
      steps: [
        { step: 'prepare', attempt: 1, status: 'done' },
        { step: 'implement', attempt: 1, status: 'done' },
        { step: 'implement', attempt: 2, status: 'failed' },
      ],
    });

    const rows = await byTicket(fx);

    // The re-run of prepare is open, although a later step has a done row.
    expect(rows['FE-201']?.current_step).toBe('prepare');
    // Every step is done: the last one that was done.
    expect(rows['FE-202']?.current_step).toBe('implement');
    // No steps yet.
    expect(rows['FE-203']?.current_step ?? null).toBeNull();
    // An older done attempt does not make a step finished when its latest attempt failed.
    expect(rows['FE-204']?.current_step).toBe('implement');
  });

  test('a reported cost of zero is shown as reported, and a run without cost events shows no cost', async () => {
    const fx = statusFixture();
    fx.addRun({ runId: 'run-601', ticket: 'FE-601', status: 'passed', lastEventAgoMs: MINUTE, costs: [{ usd: 0, source: 'reported' }] });
    fx.addRun({ runId: 'run-602', ticket: 'FE-602', status: 'passed', lastEventAgoMs: 2 * MINUTE });

    const rows = await byTicket(fx);

    expect(rows['FE-601']).toMatchObject({ cost_usd: 0, cost_source: 'reported' });
    expect(rows['FE-602']?.cost_usd).toBeUndefined();
    expect(rows['FE-602']?.cost_source).toBeUndefined();
  });
});

describe('listRuns: a run whose process is gone', () => {
  test('a run in a phase whose recorded pid is gone is listed as stale and keeps its stored status', async () => {
    const fx = statusFixture();
    fx.addRun({ runId: 'run-701', ticket: 'FE-701', status: 'building', lastEventAgoMs: MINUTE, process: 'gone' });

    const rows = await list(fx);

    expect(rows[0]).toMatchObject({ ticket: 'FE-701', status: 'building', stale: true });
  });

  test('a run in a phase whose pid now runs another command is listed as stale', async () => {
    const fx = statusFixture();
    fx.addRun({ runId: 'run-702', ticket: 'FE-702', status: 'verifying', lastEventAgoMs: MINUTE, process: 'recycled' });

    const rows = await list(fx);

    expect(rows[0]).toMatchObject({ ticket: 'FE-702', status: 'verifying', stale: true });
  });

  test('a run in a phase whose process still matches is not stale', async () => {
    const fx = statusFixture();
    fx.addRun({ runId: 'run-703', ticket: 'FE-703', status: 'building', lastEventAgoMs: MINUTE, process: 'live' });

    const rows = await list(fx);

    expect(rows[0]).toMatchObject({ ticket: 'FE-703', stale: false });
  });

  test('a run in a phase with no process row at all is listed as stale', async () => {
    const fx = statusFixture();
    fx.addRun({ runId: 'run-704', ticket: 'FE-704', status: 'planning', lastEventAgoMs: MINUTE });

    const rows = await list(fx);

    expect(rows[0]).toMatchObject({ ticket: 'FE-704', status: 'planning', stale: true });
  });

  test('a run with one gone and one live process row is not stale', async () => {
    const fx = statusFixture();
    fx.addRun({ runId: 'run-705', ticket: 'FE-705', status: 'building', lastEventAgoMs: MINUTE, process: 'gone' });
    fx.log.appendProcess({ run_id: 'run-705', step: 'verify', pid: 7001, command: 'agent --example-second' });
    fx.processTable.record({ pid: 7001, command: 'agent --example-second', startedAt: NOW });

    const rows = await list(fx);

    expect(rows[0]).toMatchObject({ ticket: 'FE-705', stale: false });
  });

  test('a finished run with a gone process row is not stale', async () => {
    const fx = statusFixture();
    fx.addRun({ runId: 'run-706', ticket: 'FE-706', status: 'killed', lastEventAgoMs: MINUTE, process: 'gone' });
    fx.addRun({ runId: 'run-707', ticket: 'FE-707', status: 'passed', lastEventAgoMs: 2 * MINUTE, process: 'gone' });

    const rows = await list(fx);

    expect(rows.map((row) => [row.ticket, row.stale])).toEqual([
      ['FE-706', false],
      ['FE-707', false],
    ]);
  });
});

describe('listRuns: one ticket', () => {
  test('lists only the runs of that ticket, in every repo, active first', async () => {
    const fx = statusFixture();
    fx.addRun({ runId: 'run-a', ticket: 'FE-123', status: 'passed', lastEventAgoMs: 2 * HOUR });
    fx.addRun({ runId: 'run-b', ticket: 'FE-123', repo: 'example-other', status: 'passed', lastEventAgoMs: 3 * HOUR });
    fx.addRun({ runId: 'run-c', ticket: 'FE-123', status: 'building', lastEventAgoMs: 4 * HOUR, process: 'live' });
    fx.addRun({ runId: 'run-d', ticket: 'FE-124', status: 'building', lastEventAgoMs: MINUTE, process: 'live' });
    fx.addRun({ runId: 'run-e', ticket: 'FE-125', status: 'passed', lastEventAgoMs: MINUTE });

    const rows = await list(fx, 'FE-123');

    expect(rows.map((row) => [row.run_id, row.repo])).toEqual([
      ['run-c', 'example-frontend'],
      ['run-a', 'example-frontend'],
      ['run-b', 'example-other'],
    ]);
  });

  test('a ticket with no runs gives an empty list', async () => {
    const fx = statusFixture();
    seedThreeRuns(fx);

    expect(await list(fx, 'FE-999')).toEqual([]);
  });
});
