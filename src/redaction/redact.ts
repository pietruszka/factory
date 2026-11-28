/**
 * Redaction for text that is about to be stored (the event log, later the run folder).
 *
 * Two layers, both replacing with `[REDACTED]`:
 * 1. exact values of loaded secrets (environment values with a secret-like name, plus extras);
 * 2. a best-effort scan for well-known token prefixes and PEM private-key blocks.
 */

const REDACTED = '[REDACTED]';

/** Exact-value secrets shorter than this are skipped: they would blank out ordinary text. */
const MIN_SECRET_LENGTH = 6;

const SECRET_NAME_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL)/i;

// A prefix alone ("sk-") is not a token, so a body of at least 8 characters is required.
const TOKEN_PATTERN = /\b(?:gh[opus]_|github_pat_|sk-|AKIA|xox[bpa]-)[A-Za-z0-9_-]{8,}/g;

// An unterminated block (no END line) is redacted to the end of the text.
const PEM_PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g;

/**
 * Secret values to replace exactly: values of environment names matching KEY, TOKEN, SECRET,
 * PASSWORD, PASS, AUTH or CREDENTIAL, plus `extra`. Values shorter than 6 characters are skipped.
 * Longest first, so a secret that contains another one is replaced whole.
 */
export function collectSecretValues(env: NodeJS.ProcessEnv, extra: readonly string[] = []): string[] {
  const fromEnv = Object.entries(env)
    .filter(([name]) => SECRET_NAME_PATTERN.test(name))
    .map(([, value]) => value);
  const values = [...fromEnv, ...extra].filter(
    (value): value is string => typeof value === 'string' && value.length >= MIN_SECRET_LENGTH,
  );
  return [...new Set(values)].sort((left, right) => right.length - left.length);
}

/** Replaces every secret value, then every token-like string and PEM private-key block. */
export function redactText(text: string, secrets: readonly string[]): string {
  const exact = secrets.reduce(
    (current, secret) => (secret === '' ? current : current.split(secret).join(REDACTED)),
    text,
  );
  return exact.replace(PEM_PRIVATE_KEY_PATTERN, REDACTED).replace(TOKEN_PATTERN, REDACTED);
}

/** Returns a copy of `value` with every string, and every object key, redacted. Other values are kept. */
export function redactValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') {
    return redactText(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, secrets));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [redactText(key, secrets), redactValue(entry, secrets)]),
    );
  }
  return value;
}
