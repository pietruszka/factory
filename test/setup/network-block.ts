import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import { promisify } from 'node:util';

const BLOCK_MESSAGE = 'Network access blocked in tests.';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
// Wildcard bind addresses: Node's dgram resolves them when it implicitly binds a sender.
// Resolving a literal address sends no query, and these never name a remote host.
const WILDCARD_BIND_HOSTS = new Set(['0.0.0.0', '::']);
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

/** Destination host of `dgram.Socket#connect(port, address?, cb?)`. */
function hostFromDgramConnectArgs(args: unknown[]): string | undefined {
  return typeof args[1] === 'string' ? args[1] : undefined;
}

/** Destination host of `dgram.Socket#send(msg, [offset, length,] [port, [address,]] cb?)`. */
function hostFromDgramSendArgs(args: unknown[]): string | undefined {
  const withOffsetAndLength = typeof args[1] === 'number' && typeof args[2] === 'number';
  const address = withOffsetAndLength ? args[4] : args[2];
  return typeof address === 'string' ? address : undefined;
}

type AnyFn = (...args: unknown[]) => unknown;
type DnsTarget = Record<string, unknown>;

// Every DNS API whose first argument is the name or address to look up.
const DNS_METHODS = [
  'lookup',
  'lookupService',
  'reverse',
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

/**
 * Replaces the DNS methods on `target`: a non-local name is refused, everything else passes through.
 * Callback APIs report the refusal to the callback, promise APIs reject. Nothing reaches the resolver.
 */
function guardDnsMethods(target: DnsTarget, mode: 'callback' | 'promise'): void {
  for (const method of DNS_METHODS) {
    const original = target[method];
    if (typeof original !== 'function') {
      continue;
    }
    target[method] = function guardedDns(this: unknown, ...args: unknown[]) {
      const host = typeof args[0] === 'string' ? args[0] : undefined;
      // Only lookup gets the wildcard bind hosts: Node resolves them with lookup when a UDP socket binds implicitly.
      const wildcardBind = method === 'lookup' && host !== undefined && WILDCARD_BIND_HOSTS.has(host);
      if (isAllowedHost(host) || wildcardBind) {
        return (original as AnyFn).apply(this, args);
      }
      const error = new Error(`${BLOCK_MESSAGE} host=${host}`);
      if (mode === 'promise') {
        return Promise.reject(error);
      }
      const callback = args.find((arg): arg is (error: Error) => void => typeof arg === 'function');
      if (!callback) {
        throw error;
      }
      process.nextTick(callback, error);
      return undefined;
    };
  }
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

  const originalDgramConnect = dgram.Socket.prototype.connect;
  const originalDgramSend = dgram.Socket.prototype.send;

  // UDP is not covered by the TCP patches above.
  dgram.Socket.prototype.connect = function patchedDgramConnect(this: dgram.Socket, ...args: unknown[]) {
    assertAllowedHost(hostFromDgramConnectArgs(args));
    return originalDgramConnect.call(this, ...(args as Parameters<typeof dgram.Socket.prototype.connect>));
  } as typeof dgram.Socket.prototype.connect;

  dgram.Socket.prototype.send = function patchedDgramSend(this: dgram.Socket, ...args: unknown[]) {
    assertAllowedHost(hostFromDgramSendArgs(args));
    return originalDgramSend.call(this, ...(args as Parameters<typeof dgram.Socket.prototype.send>));
  } as typeof dgram.Socket.prototype.send;

  // DNS: resolver APIs, the default resolver and Resolver instances, callback and promise forms.
  guardDnsMethods(dns as unknown as DnsTarget, 'callback');
  guardDnsMethods(dns.Resolver.prototype as unknown as DnsTarget, 'callback');
  guardDnsMethods(dns.promises as unknown as DnsTarget, 'promise');
  guardDnsMethods(dns.promises.Resolver.prototype as unknown as DnsTarget, 'promise');
  // util.promisify(dns.lookup) must reach the guarded promise form, not the original one.
  (dns.lookup as unknown as Record<symbol, unknown>)[promisify.custom] = dns.promises.lookup;
  (dns.lookupService as unknown as Record<symbol, unknown>)[promisify.custom] = dns.promises.lookupService;
  syncBuiltinESMExports();

  globalWithMarker[PATCH_MARKER] = true;
}
