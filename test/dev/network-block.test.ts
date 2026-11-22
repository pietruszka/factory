import dgram from 'node:dgram';
import dns, { lookup as namedLookup } from 'node:dns';
import { readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import net, { Socket } from 'node:net';
import { join, resolve, sep } from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, test } from 'vitest';

import { findModelSpawnOffenders } from '../support/model-spawn-scan.js';

test('blocks non-localhost network access from tests', async () => {
  await expect(fetch('https://example.com')).rejects.toThrow(/network access blocked/i);
  const socket = new Socket();
  expect(() => socket.connect({ host: 'example.com', port: 443 })).toThrow(/network access blocked/i);
  expect(() => net.connect({ host: 'example.com', port: 443 })).toThrow(/network access blocked/i);
  expect(() => net.createConnection({ host: 'example.com', port: 443 })).toThrow(
    /network access blocked/i,
  );
  expect(() => tls.connect({ host: 'example.com', port: 443 })).toThrow(/network access blocked/i);
  expect(() => {
    const request = http.request({ host: 'example.com', port: 80, method: 'GET' });
    request.end();
  }).toThrow(/network access blocked/i);
  expect(() => https.get({ host: 'example.com', port: 443 })).toThrow(/network access blocked/i);
});

test('allows localhost over net and fetch', async () => {
  const hits: string[] = [];
  const server = net.createServer((socket) => {
    hits.push('connection');
    socket.once('data', () => {
      hits.push('data');
      socket.write('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok');
      socket.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP address.');
    }

    await new Promise<void>((resolve, reject) => {
      const localSocket = net.connect({ host: '127.0.0.1', port: address.port });
      localSocket.once('connect', () => {
        hits.push('net-connect');
        localSocket.end();
      });
      localSocket.once('close', () => resolve());
      localSocket.once('error', reject);
    });

    const response = await fetch(`http://127.0.0.1:${address.port}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(hits).toContain('net-connect');
    expect(hits).toContain('connection');
    expect(hits).toContain('data');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('allows bracketed IPv6 localhost host for fetch when IPv6 is available', async () => {
  const server = net.createServer((socket) => {
    socket.once('data', () => {
      socket.write('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok');
      socket.end();
    });
  });

  const listenResult = await new Promise<'ready' | 'skip'>((resolve, reject) => {
    server.once('error', (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EADDRNOTAVAIL' || code === 'EAFNOSUPPORT') {
        resolve('skip');
        return;
      }
      reject(error);
    });
    server.listen(0, '::1', () => resolve('ready'));
  });

  if (listenResult === 'skip') {
    server.close();
    return;
  }

  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected IPv6 TCP address.');
    }
    const response = await fetch(`http://[::1]:${address.port}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('network guard gaps and model calls', () => {
  // Characterisation tests: the existing guard already satisfies these.
  test("fetch('https://example.com') rejects with \"Network access blocked in tests.\"", async () => {
    await expect(fetch('https://example.com')).rejects.toThrow('Network access blocked in tests.');
  });

  test("net.connect(443, '1.1.1.1') throws", () => {
    expect(() => net.connect(443, '1.1.1.1')).toThrow('Network access blocked in tests.');
  });

  test('http.get to localhost on an ephemeral server succeeds', async () => {
    const server = http.createServer((_request, response) => response.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected TCP address.');
      }
      const body = await new Promise<string>((resolve, reject) => {
        http
          .get({ host: '127.0.0.1', port: address.port }, (response) => {
            let text = '';
            response.setEncoding('utf8');
            response.on('data', (chunk: string) => (text += chunk));
            response.on('end', () => resolve(text));
          })
          .on('error', reject);
      });
      expect(body).toBe('ok');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('http2.connect to a non-local host throws', () => {
    expect(() => http2.connect('https://192.0.2.1')).toThrow(/network access blocked/i);
  });

  // 192.0.2.1 is a documentation address; nothing is sent when the guard works.
  test('a UDP socket cannot connect to a non-local host', () => {
    const socket = dgram.createSocket('udp4');
    socket.on('error', () => undefined);
    try {
      expect(() => socket.connect(53, '192.0.2.1')).toThrow(/network access blocked/i);
    } finally {
      socket.close();
    }
  });

  test('a UDP socket cannot send to a non-local host, with or without offset and length', () => {
    const socket = dgram.createSocket('udp4');
    socket.on('error', () => undefined);
    try {
      expect(() => socket.send('x', 53, '192.0.2.1')).toThrow(/network access blocked/i);
      expect(() => socket.send(Buffer.from('x'), 0, 1, 53, '192.0.2.1')).toThrow(/network access blocked/i);
    } finally {
      socket.close();
    }
  });

  test('a UDP socket can send to localhost', async () => {
    const receiver = dgram.createSocket('udp4');
    const sender = dgram.createSocket('udp4');
    try {
      await new Promise<void>((resolve) => receiver.bind(0, '127.0.0.1', resolve));
      const received = new Promise<string>((resolve) => receiver.once('message', (msg) => resolve(msg.toString())));
      sender.send('ping', receiver.address().port, '127.0.0.1');

      expect(await received).toBe('ping');
    } finally {
      sender.close();
      receiver.close();
    }
  });

  test('no test file spawns agent, cursor-agent or opencode except through test/support/fake-cli.ts', () => {
    const testRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
    const allowed = [join(testRoot, 'support', 'fake-cli.ts')];
    const sources = Object.fromEntries(
      readdirSync(testRoot, { recursive: true, encoding: 'utf8' })
        .filter((name) => name.endsWith('.ts') && !name.startsWith(`fixtures${sep}`))
        .map((name) => join(testRoot, name))
        .map((file) => [file, readFileSync(file, 'utf8')]),
    );

    expect(Object.keys(sources).length).toBeGreaterThan(0);
    expect(findModelSpawnOffenders(sources, allowed)).toEqual([]);
  });
});

describe('the model-spawn scanner is sensitive', () => {
  // Fixtures are built at runtime so this file never contains a forbidden spawn itself.
  const fixture = (call: string, name: string): string => `${call}(${JSON.stringify(name)}, ['--print']);`;
  const CALLS = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];
  const NAMES = ['agent', 'cursor-agent', 'opencode'];
  const cases = NAMES.flatMap((name) => CALLS.map((call) => [call, name] as const));

  test.each(cases)('%s of %s in a test file is flagged', (call, name) => {
    const sources = { 'test/some/thing.test.ts': fixture(call, name) };

    expect(findModelSpawnOffenders(sources, [])).toEqual(['test/some/thing.test.ts']);
  });

  test('the same spawn in an allowed file (test/support/fake-cli.ts) is not flagged', () => {
    const path = 'test/support/fake-cli.ts';
    const sources = { [path]: fixture('spawn', 'agent'), 'test/ok.test.ts': fixture('spawn', 'node') };

    expect(findModelSpawnOffenders(sources, [path])).toEqual([]);
  });

  test('spawning an unrelated binary is not flagged', () => {
    expect(findModelSpawnOffenders({ 'test/a.test.ts': fixture('spawn', 'git') }, [])).toEqual([]);
  });

  test('the real test/support/fake-cli.ts is allowed', () => {
    const fakeCli = resolve(fileURLToPath(new URL('../support/fake-cli.ts', import.meta.url)));
    const sources = { [fakeCli]: readFileSync(fakeCli, 'utf8') };

    expect(findModelSpawnOffenders(sources, [fakeCli])).toEqual([]);
  });
});

describe('DNS resolver guard', () => {
  // `.invalid` never resolves (RFC 6761), so a failing guard still cannot reach a real host.
  const NAME = 'factory-test.invalid';
  const BLOCKED = /network access blocked/i;
  const RESOLVE_METHODS = [
    'resolve',
    'resolve4',
    'resolve6',
    'resolveAny',
    'resolveCaa',
    'resolveCname',
    'resolveMx',
    'resolveNaptr',
    'resolveNs',
    'resolvePtr',
    'resolveSoa',
    'resolveSrv',
    'resolveTxt',
  ] as const;

  type Callback = (error: Error | null, ...rest: unknown[]) => void;
  type Fn = (name: string, cb: Callback) => unknown;
  const callbackError = (fn: Fn): Promise<Error | null> =>
    new Promise((resolve) => {
      try {
        fn(NAME, (error) => resolve(error));
      } catch (error) {
        resolve(error as Error);
      }
    });

  test('dns.lookup of a non-local name is refused', async () => {
    const error = await callbackError((name, cb) => dns.lookup(name, cb));

    expect(error?.message).toMatch(BLOCKED);
  });

  test('dns.promises.lookup of a non-local name rejects', async () => {
    await expect(dns.promises.lookup(NAME)).rejects.toThrow(BLOCKED);
  });

  test('a named import of lookup is refused too', async () => {
    const error = await callbackError((name, cb) => namedLookup(name, cb));

    expect(error?.message).toMatch(BLOCKED);
  });

  test.each(RESOLVE_METHODS)('dns.%s of a non-local name is refused', async (method) => {
    const fn = dns[method] as unknown as Fn;
    const error = await callbackError((name, cb) => fn.call(dns, name, cb));

    expect(error?.message).toMatch(BLOCKED);
  });

  test.each(RESOLVE_METHODS)('dns.promises.%s of a non-local name rejects', async (method) => {
    const fn = dns.promises[method] as unknown as (name: string) => Promise<unknown>;

    await expect(fn.call(dns.promises, NAME)).rejects.toThrow(BLOCKED);
  });

  test('new dns.Resolver() refuses a non-local name', async () => {
    const resolver = new dns.Resolver();
    const error = await callbackError((name, cb) => resolver.resolve4(name, cb));

    expect(error?.message).toMatch(BLOCKED);
  });

  test('new dns.promises.Resolver() rejects a non-local name', async () => {
    const resolver = new dns.promises.Resolver();

    await expect(resolver.resolve4(NAME)).rejects.toThrow(BLOCKED);
  });

  // 192.0.2.1 is a documentation address (RFC 5737); no real query is made.
  test('dns.lookupService of a non-local address is refused (callback form)', async () => {
    const error = await callbackError((_name, cb) => dns.lookupService('192.0.2.1', 80, cb));

    expect(error?.message).toMatch(BLOCKED);
  });

  test('dns.promises.lookupService of a non-local address rejects (promise form)', async () => {
    await expect(dns.promises.lookupService('192.0.2.1', 80)).rejects.toThrow(BLOCKED);
  });

  test('reverse lookup of a non-local address is refused', async () => {
    const error = await callbackError((_name, cb) => dns.reverse('192.0.2.1', cb));

    expect(error?.message).toMatch(BLOCKED);
  });

  test('the wildcard bind addresses are refused by resolver APIs other than lookup', async () => {
    for (const host of ['0.0.0.0', '::']) {
      expect((await callbackError((_name, cb) => dns.reverse(host, cb)))?.message).toMatch(BLOCKED);
      expect((await callbackError((_name, cb) => dns.lookupService(host, 80, cb)))?.message).toMatch(BLOCKED);
      expect((await callbackError((_name, cb) => dns.resolve4(host, cb)))?.message).toMatch(BLOCKED);
      await expect(dns.promises.resolve(host)).rejects.toThrow(BLOCKED);
      await expect(dns.promises.reverse(host)).rejects.toThrow(BLOCKED);
    }
  });

  test('util.promisify(dns.lookup) of a non-local name rejects', async () => {
    await expect(promisify(dns.lookup)(NAME)).rejects.toThrow(BLOCKED);
  });

  test('localhost still resolves to a loopback address', async () => {
    const result = await dns.promises.lookup('localhost');

    expect(['127.0.0.1', '::1']).toContain(result.address);
  });

  test('literal loopback addresses still resolve through the callback API', async () => {
    const address = await new Promise<string>((resolve, reject) => {
      dns.lookup('127.0.0.1', (error, value) => (error ? reject(error) : resolve(value)));
    });

    expect(address).toBe('127.0.0.1');
  });
});
