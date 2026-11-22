import { describe, expect, test } from 'vitest';

import { createRecordingCodeHost } from '../../src/ports/code-host.js';
import { createRecordingTicketSource } from '../../src/ports/ticket-source.js';

const PUSH = { repo: 'example-org/example-frontend', branch: 'feat/FE-123-example' };
const DRAFT = { ...PUSH, title: 'FE-123 example', body: 'Example body.' };
const PR = {
  number: 7,
  title: 'FE-123 example',
  url: 'https://example.invalid/example-org/example-frontend/pull/7',
  headBranch: 'feat/FE-123-example',
};

/** Resolves with the thrown value so a test can inspect it. */
const caught = async (fn: () => Promise<unknown>): Promise<unknown> => {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe('a CodeHost recording fake', () => {
  test('records push and openDraftPr calls and, with an empty allow-list, throws so the test fails', async () => {
    const host = createRecordingCodeHost({});

    const pushError = await caught(() => host.push(PUSH));
    const draftError = await caught(() => host.openDraftPr(DRAFT));

    expect(pushError).toMatchObject({ code: 'write_not_allowed', exitCode: 2 });
    expect(draftError).toMatchObject({ code: 'write_not_allowed', exitCode: 2 });
    expect(host.calls.map((call) => call.method)).toEqual(['push', 'openDraftPr']);
  });

  test('the same write succeeds only after it is added to the allow-list, and is still recorded', async () => {
    const host = createRecordingCodeHost({});
    host.allow('push');

    await expect(host.push(PUSH)).resolves.toBeUndefined();
    const draftError = await caught(() => host.openDraftPr(DRAFT));

    expect(draftError).toMatchObject({ code: 'write_not_allowed' });
    expect(host.calls).toEqual([
      { method: 'push', args: PUSH },
      { method: 'openDraftPr', args: DRAFT },
    ]);
  });

  test('returns a scripted pull request for a read and records the fetch', async () => {
    const host = createRecordingCodeHost({ pullRequests: { 'example-org/example-frontend#7': PR } });

    await expect(host.fetchPullRequest('example-org/example-frontend', 7)).resolves.toEqual(PR);
    expect(host.calls.map((call) => call.method)).toEqual(['fetchPullRequest']);
  });
});

describe('a TicketSource recording fake', () => {
  const TICKET = { key: 'FE-123', summary: 'Example summary', description: 'Example description.' };

  test('returns a scripted ticket and records the fetch; it has no write method', async () => {
    const source = createRecordingTicketSource({ tickets: { 'FE-123': TICKET } });

    await expect(source.fetchTicket('FE-123')).resolves.toEqual(TICKET);

    expect(source.calls).toEqual([{ method: 'fetchTicket', key: 'FE-123' }]);
    expect(Object.keys(source).sort()).toEqual(['calls', 'fetchTicket']);
  });
});
