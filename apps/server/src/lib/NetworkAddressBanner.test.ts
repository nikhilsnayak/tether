import { Effect, Layer } from 'effect';
import { HttpServer } from 'effect/unstable/http';
import { assert, describe, it, vi } from 'vitest';

import { formatNetworkAddressBanner, NetworkAddressBanner } from './NetworkAddressBanner';

vi.mock('node:os', () => ({ networkInterfaces: () => ({}) }));

describe('formatNetworkAddressBanner', () => {
  it('includes external IPv4 addresses and excludes internal or IPv6 addresses', () => {
    const output = formatNetworkAddressBanner(8008, {
      ethernet: [
        {
          address: '192.168.1.20',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: false,
          cidr: '192.168.1.20/24',
        },
        {
          address: 'fe80::1',
          netmask: 'ffff:ffff:ffff:ffff::',
          family: 'IPv6',
          mac: '00:00:00:00:00:00',
          internal: false,
          cidr: 'fe80::1/64',
          scopeid: 0,
        },
      ],
      loopback: [
        {
          address: '127.0.0.1',
          netmask: '255.0.0.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: true,
          cidr: '127.0.0.1/8',
        },
      ],
      unavailable: undefined,
    });

    assert.strictEqual(
      output,
      '  ➜  Local:    ws://localhost:8008/\n  ➜  Network:  ws://192.168.1.20:8008/',
    );
  });

  it('logs addresses for a TCP server', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const server = HttpServer.make({
      address: { _tag: 'TcpAddress', hostname: '0.0.0.0', port: 8008 },
      serve: () => Effect.never,
    });

    await Effect.runPromise(
      Effect.scoped(
        Layer.build(
          NetworkAddressBanner.pipe(Layer.provide(Layer.succeed(HttpServer.HttpServer, server))),
        ),
      ),
    );

    assert.strictEqual(log.mock.calls[0]?.[0], '  ➜  Local:    ws://localhost:8008/');
    log.mockRestore();
  });

  it('does not log addresses for a Unix socket', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const server = HttpServer.make({
      address: { _tag: 'UnixAddress', path: '/tmp/tether.sock' },
      serve: () => Effect.never,
    });

    await Effect.runPromise(
      Effect.scoped(
        Layer.build(
          NetworkAddressBanner.pipe(Layer.provide(Layer.succeed(HttpServer.HttpServer, server))),
        ),
      ),
    );

    assert.lengthOf(log.mock.calls, 0);
    log.mockRestore();
  });
});
