import { describe, expect, test } from 'vitest';

import { redactProbeValue } from '../../src/probe/redact.js';

describe('redactProbeValue', () => {
  test('a ghp_ token that is not in the secret list is replaced', () => {
    const token = 'ghp_EXAMPLE_NOT_A_REAL_TOKEN';

    expect(redactProbeValue(`before ${token} after`, [])).toBe('before [REDACTED] after');
  });

  test('a PEM private-key block that is not in the secret list is replaced', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nEXAMPLENOTAREALKEYMATERIAL\n-----END PRIVATE KEY-----';

    expect(redactProbeValue(`key:\n${pem}\ndone`, [])).toBe('key:\n[REDACTED]\ndone');
  });

  test('object keys are left alone while string values are redacted', () => {
    const token = 'ghp_EXAMPLE_NOT_A_REAL_TOKEN';

    expect(redactProbeValue({ [token]: `has ${token}` }, [])).toEqual({
      [token]: 'has [REDACTED]',
    });
  });
});
