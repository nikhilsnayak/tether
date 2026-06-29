import { networkInterfaces } from 'node:os';

import { Console, Effect, Layer } from 'effect';
import { HttpServer } from 'effect/unstable/http';

export const NetworkAddressBanner = Layer.effectDiscard(
  Effect.gen(function* () {
    const { address } = yield* HttpServer.HttpServer;
    if (address._tag !== 'TcpAddress') return;

    const lines = [`  ➜  Local:    ws://localhost:${address.port}/`];
    for (const iface of Object.values(networkInterfaces()).flat()) {
      if (iface?.family === 'IPv4' && !iface.internal) {
        lines.push(`  ➜  Network:  ws://${iface.address}:${address.port}/`);
      }
    }

    yield* Console.log(lines.join('\n'));
  }),
);
