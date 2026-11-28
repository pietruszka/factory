import { FactoryError } from '../platform/errors.js';

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  headBranch: string;
  /** ISO-8601 time the pull request was merged; absent or null when it is not merged. */
  mergedAt?: string | null;
}

type CodeHostWrite = 'push' | 'openDraftPr';

export interface CodeHost {
  fetchPullRequest(repo: string, number: number): Promise<PullRequest>;
  push(input: { repo: string; branch: string }): Promise<void>;
  openDraftPr(input: { repo: string; branch: string; title: string; body: string }): Promise<PullRequest>;
}

export interface CodeHostCall {
  method: 'fetchPullRequest' | CodeHostWrite;
  args: unknown;
}

export interface RecordingCodeHost extends CodeHost {
  readonly calls: readonly CodeHostCall[];
  /** Puts a write on the allow-list. The default allow-list is empty. */
  allow(method: CodeHostWrite): void;
}

/**
 * A CodeHost that records every call. A write throws `write_not_allowed` until the test allows it.
 * Reads return the scripted pull requests, keyed `owner/repo#number`.
 */
export function createRecordingCodeHost(options: {
  pullRequests?: Record<string, PullRequest>;
}): RecordingCodeHost {
  const calls: CodeHostCall[] = [];
  const allowed = new Set<CodeHostWrite>();

  const guardWrite = (method: CodeHostWrite, args: unknown): void => {
    calls.push({ method, args });
    if (allowed.has(method)) return;
    throw new FactoryError({
      code: 'write_not_allowed',
      message: `The test fake refused ${method}: it is not on the allow-list.`,
      where: `CodeHost.${method}`,
      next: `call allow('${method}') in the test if this write is expected`,
      exitCode: 2,
    });
  };

  return {
    calls,
    allow: (method) => {
      allowed.add(method);
    },
    fetchPullRequest: (repo, number) => {
      calls.push({ method: 'fetchPullRequest', args: { repo, number } });
      const pullRequest = options.pullRequests?.[`${repo}#${number}`];
      if (!pullRequest) {
        return Promise.reject(new Error(`No scripted pull request for ${repo}#${number}.`));
      }
      return Promise.resolve(pullRequest);
    },
    push: (input) =>
      Promise.resolve().then(() => {
        guardWrite('push', input);
      }),
    openDraftPr: (input) =>
      Promise.resolve().then(() => {
        guardWrite('openDraftPr', input);
        return {
          number: 1,
          title: input.title,
          url: `https://example.invalid/${input.repo}/pull/1`,
          headBranch: input.branch,
        };
      }),
  };
}
