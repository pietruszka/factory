import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { createRunFolder } from '../../src/run-folder/create.js';
import { savePrompt } from '../../src/run-folder/prompts.js';
import { errorFields, thrownBy } from '../support/event-log.js';
import { cleanupTempHomes, makeTempHome } from '../support/temp-home.js';

afterEach(cleanupTempHomes);

const ENV_SECRET = 'example-fake-secret-value-0001';
const PATTERN_SECRET = 'ghp_EXAMPLE_NOT_A_REAL_TOKEN';

function sandbox(): { env: NodeJS.ProcessEnv; folder: string } {
  const tmp = makeTempHome();
  const home = join(tmp, 'factory-home');
  return {
    env: { HOME: tmp, FACTORY_HOME: home, EXAMPLE_SERVICE_TOKEN: ENV_SECRET },
    folder: join(home, 'runs', 'example-frontend', 'FE-123'),
  };
}

function save(env: NodeJS.ProcessEnv, prompt: string, step = 'builder'): string {
  return savePrompt({ env, repo: 'example-frontend', ticket: 'FE-123', step, prompt });
}

describe('saved prompts', () => {
  test('savePrompt writes prompts/<step>.md under the run folder', () => {
    const sb = sandbox();
    createRunFolder({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123' });

    const path = save(sb.env, 'Implement the change described in FE-123.\n');

    expect(path).toBe(join(sb.folder, 'prompts', 'builder.md'));
    expect(readFileSync(path, 'utf8')).toBe('Implement the change described in FE-123.\n');
  });

  test('an environment value in a name matching TOKEN is replaced with [REDACTED] in the saved prompt', () => {
    const sb = sandbox();
    createRunFolder({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123' });

    const path = save(sb.env, `Use the credential ${ENV_SECRET} to call the service.`);

    expect(readFileSync(path, 'utf8')).toBe('Use the credential [REDACTED] to call the service.');
  });

  test('a string starting with ghp_ is replaced even when it is not in the environment', () => {
    const sb = sandbox();
    createRunFolder({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123' });

    const path = save(sb.env, `The log shows ${PATTERN_SECRET} in a header.`);

    expect(readFileSync(path, 'utf8')).toBe('The log shows [REDACTED] in a header.');
  });

  test('the raw secret does not appear in the file', () => {
    const sb = sandbox();
    createRunFolder({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123' });

    const path = save(sb.env, `first ${ENV_SECRET}\nsecond ${PATTERN_SECRET}\nthird ${ENV_SECRET}\n`);

    const content = readFileSync(path, 'utf8');
    expect(content).toContain('[REDACTED]');
    expect(content).not.toContain(ENV_SECRET);
    expect(content).not.toContain(PATTERN_SECRET);
    expect(content).not.toContain('ghp_');
  });

  test('a step name that contains a slash is refused as run_folder_invalid', () => {
    const sb = sandbox();
    createRunFolder({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123' });
    const steps = ['a/b', '../x', '..', '/tmp/escape', ''];

    const results = steps.map((step) => {
      const error = errorFields(thrownBy(() => save(sb.env, 'prompt text', step)));
      return { step, code: error.code, exitCode: error.exitCode };
    });

    expect(results).toEqual(steps.map((step) => ({ step, code: 'run_folder_invalid', exitCode: 2 })));
    expect(readdirSync(join(sb.folder, 'prompts'))).toEqual([]);
    expect(existsSync(join(sb.folder, 'x.md'))).toBe(false);
  });
});
