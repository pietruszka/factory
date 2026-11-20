import http from 'node:http';
import https from 'node:https';
import net, { Socket } from 'node:net';
import tls from 'node:tls';

import { expect, test } from 'vitest';

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
