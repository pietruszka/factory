import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { normaliseOrigin, samePath } from '../../src/config/origin.js';
import { cleanupTempHomes, makeTempHome } from '../support/temp-home.js';

afterEach(cleanupTempHomes);

const EXPECTED = 'github.com/example-org/example-frontend';

describe('normaliseOrigin', () => {
  test.each([
    ['https with .git', 'https://github.com/example-org/example-frontend.git'],
    ['https without .git', 'https://github.com/example-org/example-frontend'],
    ['http', 'http://github.com/example-org/example-frontend.git'],
    ['ssh scheme', 'ssh://git@github.com/example-org/example-frontend.git'],
    ['scp form', 'git@github.com:example-org/example-frontend.git'],
    ['scp form without user', 'github.com:example-org/example-frontend.git'],
    ['trailing slash', 'https://github.com/example-org/example-frontend/'],
    ['trailing .git and slash', 'https://github.com/example-org/example-frontend.git/'],
    ['upper-case scheme and host', 'HTTPS://GitHub.COM/example-org/example-frontend.git'],
    ['userinfo', 'https://someone@github.com/example-org/example-frontend.git'],
    ['default https port', 'https://github.com:443/example-org/example-frontend.git'],
    ['host and path only', 'github.com/example-org/example-frontend'],
    ['host and path with .git', 'GitHub.com/example-org/example-frontend.git'],
    ['default ssh port', 'ssh://git@github.com:22/example-org/example-frontend.git'],
  ])('%s normalises to host/path', (_label, url) => {
    expect(normaliseOrigin(url)).toBe(EXPECTED);
  });

  test('a non-default port is kept', () => {
    expect(normaliseOrigin('https://git.example.test:8443/example-org/example-frontend.git')).toBe(
      'git.example.test:8443/example-org/example-frontend',
    );
  });

  test('the path keeps its case', () => {
    expect(normaliseOrigin('https://github.com/Example-Org/Example-Frontend.git')).toBe(
      'github.com/Example-Org/Example-Frontend',
    );
  });

  test.each(['', 'not a url', 'example-frontend', 'ftp://github.com/example-org/example-frontend', 'file:///tmp/example'])(
    '"%s" is not an origin',
    (url) => {
      expect(normaliseOrigin(url)).toBeUndefined();
    },
  );
});

describe('samePath', () => {
  test('the same absolute path matches', () => {
    const tmp = makeTempHome();

    expect(samePath(join(tmp, 'a'), join(tmp, 'a', '.'))).toBe(true);
  });

  test('different paths do not match', () => {
    const tmp = makeTempHome();

    expect(samePath(join(tmp, 'a'), join(tmp, 'b'))).toBe(false);
  });

  test('a symlink matches its target', () => {
    const tmp = makeTempHome();
    mkdirSync(join(tmp, 'real'));
    symlinkSync(join(tmp, 'real'), join(tmp, 'link'));

    expect(samePath(join(tmp, 'link'), join(tmp, 'real'))).toBe(true);
  });

  test('case is ignored on darwin and kept elsewhere', () => {
    const tmp = makeTempHome();

    expect(samePath(join(tmp, 'Repo'), join(tmp, 'repo'), 'darwin')).toBe(true);
    expect(samePath(join(tmp, 'Repo'), join(tmp, 'repo'), 'linux')).toBe(false);
  });
});
