import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

const BLOCK_MESSAGE = 'Network access blocked in tests.';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const PATCH_MARKER = Symbol.for('factory.networkBlockPatched');

function isAllowedHost(host: string | undefined): boolean {
  if (!host) {
    return true;
  }
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  return LOCAL_HOSTS.has(normalized);
}

function assertAllowedHost(host: string | undefined): void {
  if (!isAllowedHost(host)) {
    throw new Error(`${BLOCK_MESSAGE} host=${host}`);
  }
}

function hostFromNetConnectArgs(args: unknown[]): string | undefined {
  const first = args[0];
  const second = args[1];

  if (Array.isArray(first)) {
    return hostFromNetConnectArgs(first);
  }

  if (typeof first === 'object' && first !== null && !Array.isArray(first)) {
    const options = first as { host?: unknown; path?: unknown };
    if (typeof options.path === 'string') {
      return undefined;
    }
    return typeof options.host === 'string' ? options.host : undefined;
  }

  if (typeof first === 'string') {
    if (first.startsWith('/')) {
      return undefined;
    }
    return first;
  }

  if (typeof first === 'number') {
    return typeof second === 'string' ? second : undefined;
  }

  return undefined;
}

const globalWithMarker = globalThis as typeof globalThis & { [PATCH_MARKER]?: boolean };

if (!globalWithMarker[PATCH_MARKER]) {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? new URL(input) : input instanceof URL ? input : new URL(input.url);
    assertAllowedHost(url.hostname);
    return originalFetch(input, init);
  };

  const originalConnect = net.connect.bind(net);
  const originalCreateConnection = net.createConnection.bind(net);
  const originalSocketConnect = net.Socket.prototype.connect;
  const originalTlsConnect = tls.connect.bind(tls);
  const originalHttpAgentCreateConnection = http.Agent.prototype.createConnection;
  const originalHttpsAgentCreateConnection = https.Agent.prototype.createConnection;

  net.connect = ((...args: unknown[]) => {
    assertAllowedHost(hostFromNetConnectArgs(args));
    return originalConnect(...(args as Parameters<typeof net.connect>));
  }) as typeof net.connect;

  net.createConnection = ((...args: unknown[]) => {
    assertAllowedHost(hostFromNetConnectArgs(args));
    return originalCreateConnection(...(args as Parameters<typeof net.createConnection>));
  }) as typeof net.createConnection;

  net.Socket.prototype.connect = function patchedSocketConnect(...args: unknown[]): net.Socket {
    assertAllowedHost(hostFromNetConnectArgs(args));
    return originalSocketConnect.call(this, ...(args as Parameters<typeof net.Socket.prototype.connect>));
  };

  tls.connect = ((...args: unknown[]) => {
    assertAllowedHost(hostFromNetConnectArgs(args));
    return originalTlsConnect(...(args as Parameters<typeof tls.connect>));
  }) as typeof tls.connect;

  http.Agent.prototype.createConnection = function patchedHttpCreateConnection(...args: unknown[]) {
    assertAllowedHost(hostFromNetConnectArgs(args));
    return originalHttpAgentCreateConnection.call(
      this,
      ...(args as Parameters<typeof http.Agent.prototype.createConnection>),
    );
  };

  https.Agent.prototype.createConnection = function patchedHttpsCreateConnection(...args: unknown[]) {
    assertAllowedHost(hostFromNetConnectArgs(args));
    return originalHttpsAgentCreateConnection.call(
      this,
      ...(args as Parameters<typeof https.Agent.prototype.createConnection>),
    );
  };

  globalWithMarker[PATCH_MARKER] = true;
}
