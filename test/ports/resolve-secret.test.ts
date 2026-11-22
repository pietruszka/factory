import { afterEach, describe, expect, test } from 'vitest';

import { resolveSecret } from '../../src/config/resolve-secret.js';
import { createFakePlatform } from '../../src/ports/platform.js';
import { cleanupTempHomes, makeTempHome } from '../support/temp-home.js';

afterEach(() => {
  delete process.env.EXAMPLE_FACTORY_TOKEN;
  cleanupTempHomes();
});

const FAKE_TOKEN = 'ghp_EXAMPLE_NOT_A_REAL_TOKEN';
const config = {
  secrets: {
    host_token: { env: 'EXAMPLE_FACTORY_TOKEN' },
    ticket_token: { keychain: 'example-keychain-item' },
  },
};

const caught = async (fn: () => Promise<unknown>): Promise<unknown> => {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe('resolveSecret', () => {
  test('reads an env-backed secret from the env object it is given, not from a leftover process.env key', async () => {
    process.env.EXAMPLE_FACTORY_TOKEN = 'leftover-from-process-env';
    const env = { HOME: makeTempHome(), EXAMPLE_FACTORY_TOKEN: FAKE_TOKEN };

    const value = await resolveSecret({ env, platform: createFakePlatform(), config, name: 'host_token' });

    expect(value).toBe(FAKE_TOKEN);
  });

  test('refuses an env-backed secret that is only in process.env, not in the given env object', async () => {
    process.env.EXAMPLE_FACTORY_TOKEN = 'leftover-from-process-env';
    const env = { HOME: makeTempHome() };

    const error = await caught(() =>
      resolveSecret({ env, platform: createFakePlatform(), config, name: 'host_token' }),
    );

    expect(error).toMatchObject({ code: 'secret_missing', exitCode: 2 });
  });

  test('reads a keychain-backed secret only through Platform.keychain.get', async () => {
    const platform = createFakePlatform({ keychain: { 'example-keychain-item': FAKE_TOKEN } });
    const env = { HOME: makeTempHome(), EXAMPLE_FACTORY_TOKEN: 'env-value-must-be-ignored' };

    const value = await resolveSecret({ env, platform, config, name: 'ticket_token' });

    expect(value).toBe(FAKE_TOKEN);
    expect(platform.keychainReads).toEqual(['example-keychain-item']);
  });

  test('a missing secret is refused as secret_missing, exit code 2, and the error does not contain the value', async () => {
    const platform = createFakePlatform({ keychain: { 'some-other-item': FAKE_TOKEN } });
    const env = { HOME: makeTempHome(), UNRELATED_KEY: FAKE_TOKEN };

    const error = await caught(() => resolveSecret({ env, platform, config, name: 'ticket_token' }));

    expect(error).toMatchObject({ code: 'secret_missing', exitCode: 2 });
    const { message, where, next } = error as { message: string; where: string; next: string };
    expect(`${message} ${where} ${next}`).not.toContain(FAKE_TOKEN);
    expect(`${message} ${where} ${next}`).toContain('ticket_token');
  });

  test('a name that is not in the config is refused as secret_missing', async () => {
    const error = await caught(() =>
      resolveSecret({ env: {}, platform: createFakePlatform(), config, name: 'not_configured' }),
    );

    expect(error).toMatchObject({ code: 'secret_missing', exitCode: 2 });
  });
});

describe('a Platform fake', () => {
  test("keychain and clipboard never touch the real macOS keychain or the user's clipboard", async () => {
    const platform = createFakePlatform({
      os: 'linux',
      keychain: { 'example-item': FAKE_TOKEN },
      clipboard: 'example clipboard',
    });

    await platform.clipboard.write('copied by the test');

    expect(platform.os).toBe('linux');
    await expect(platform.keychain.get('example-item')).resolves.toBe(FAKE_TOKEN);
    await expect(platform.keychain.get('missing-item')).resolves.toBeUndefined();
    await expect(platform.clipboard.read()).resolves.toBe('copied by the test');
    expect(platform.clipboardWrites).toEqual(['copied by the test']);
    expect(platform.keychainReads).toEqual(['example-item', 'missing-item']);
  });
});
