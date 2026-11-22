import { describe, expect, test } from 'vitest';

import { collectSecretValues, redactText, redactValue } from '../../src/redaction/redact.js';

// Obviously fake fixture secrets.
const FAKE_ENV_SECRET = 'example-secret-value-123456';

describe('collectSecretValues', () => {
  test('keeps values of names matching KEY, TOKEN, SECRET, PASSWORD, PASS, AUTH and CREDENTIAL', () => {
    const env = {
      EXAMPLE_API_KEY: 'example-key-value-1',
      EXAMPLE_TOKEN: 'example-token-value-2',
      EXAMPLE_SECRET: 'example-secret-value-3',
      EXAMPLE_PASSWORD: 'example-password-value-4',
      EXAMPLE_PASS: 'example-pass-value-5',
      EXAMPLE_AUTH: 'example-auth-value-6',
      EXAMPLE_CREDENTIAL: 'example-credential-value-7',
    };

    expect(collectSecretValues(env).sort()).toEqual(Object.values(env).sort());
  });

  test('ignores values of other names', () => {
    expect(collectSecretValues({ EXAMPLE_NAME: 'plain-value-here', PATH: '/tmp/bin' })).toEqual([]);
  });

  test('a value shorter than 6 characters is not used as an exact-value secret', () => {
    expect(collectSecretValues({ EXAMPLE_TOKEN: 'abc12' })).toEqual([]);
  });

  test('adds extra values from the caller and skips short ones', () => {
    expect(collectSecretValues({}, ['extra-secret-value', 'tiny']).sort()).toEqual(['extra-secret-value']);
  });
});

describe('redactText', () => {
  test('replaces an exact secret value with [REDACTED]', () => {
    expect(redactText(`before ${FAKE_ENV_SECRET} after`, [FAKE_ENV_SECRET])).toBe('before [REDACTED] after');
  });

  test('replaces every occurrence of an exact secret that holds regex characters', () => {
    expect(redactText('a.b*c(1) and a.b*c(1)', ['a.b*c(1)'])).toBe('[REDACTED] and [REDACTED]');
  });

  test('a string starting with ghp_ is replaced with no secrets loaded', () => {
    expect(redactText('token ghp_EXAMPLE_NOT_A_REAL_TOKEN here', [])).toBe('token [REDACTED] here');
  });

  test.each([
    ['gho_', 'gho_EXAMPLE_NOT_A_REAL_TOKEN'],
    ['ghu_', 'ghu_EXAMPLE_NOT_A_REAL_TOKEN'],
    ['ghs_', 'ghs_EXAMPLE_NOT_A_REAL_TOKEN'],
    ['github_pat_', 'github_pat_EXAMPLE_NOT_A_REAL_TOKEN'],
    ['sk-', 'sk-EXAMPLE-NOT-A-REAL-KEY-1234567890'],
    ['AKIA', 'AKIAEXAMPLENOTREAL12'],
    ['xoxb-', 'xoxb-EXAMPLE-NOT-A-REAL-TOKEN'],
    ['xoxp-', 'xoxp-EXAMPLE-NOT-A-REAL-TOKEN'],
    ['xoxa-', 'xoxa-EXAMPLE-NOT-A-REAL-TOKEN'],
  ])('a token starting with %s is replaced', (_prefix, token) => {
    expect(redactText(`value ${token} end`, [])).toBe('value [REDACTED] end');
  });

  test('a PEM private-key block is replaced', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nEXAMPLENOTAREALKEYMATERIAL\n-----END PRIVATE KEY-----';

    expect(redactText(`key:\n${pem}\ndone`, [])).toBe('key:\n[REDACTED]\ndone');
  });

  test('text with no secret is returned unchanged', () => {
    expect(redactText('ordinary text for FE-123', [FAKE_ENV_SECRET])).toBe('ordinary text for FE-123');
  });
});

describe('redactValue', () => {
  test('redacts strings inside nested objects and arrays and keeps other values', () => {
    const input = { a: [FAKE_ENV_SECRET, { b: 'ghp_EXAMPLE_NOT_A_REAL_TOKEN' }], n: 3, ok: true, none: null };

    expect(redactValue(input, [FAKE_ENV_SECRET])).toEqual({
      a: ['[REDACTED]', { b: '[REDACTED]' }],
      n: 3,
      ok: true,
      none: null,
    });
  });

  test('does not change the input value', () => {
    const input = { a: FAKE_ENV_SECRET };

    redactValue(input, [FAKE_ENV_SECRET]);

    expect(input).toEqual({ a: FAKE_ENV_SECRET });
  });
});
