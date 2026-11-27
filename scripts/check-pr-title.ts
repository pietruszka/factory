import { pathToFileURL } from 'node:url';

const PR_TITLE =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)\(FAC-[0-9]+\): \S(.*\S)?$/;

/** Returns an error message when the title is wrong, otherwise undefined. */
export function prTitleError(title: string): string | undefined {
  if (PR_TITLE.test(title)) return undefined;
  return (
    'PR title must match type(FAC-N): summary, for example feat(FAC-12): add x'
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const title = process.env.PR_TITLE ?? '';
  const error = prTitleError(title);
  if (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
