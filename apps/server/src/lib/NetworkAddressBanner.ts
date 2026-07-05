import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

import { Console, Effect, Layer } from 'effect';
import { HttpServer } from 'effect/unstable/http';

export const formatNetworkAddressBanner = (
  port: number,
  interfaces: Readonly<Record<string, ReadonlyArray<NetworkInterfaceInfo> | undefined>>,
) => {
  const lines = [`  ➜  Local:    ws://localhost:${port}/`];
  for (const iface of Object.values(interfaces).flat()) {
    if (iface?.family === 'IPv4' && !iface.internal) {
      lines.push(`  ➜  Network:  ws://${iface.address}:${port}/`);
    }
  }
  return lines.join('\n');
};

export const NetworkAddressBanner = Layer.effectDiscard(
  Effect.gen(function* () {
    const { address } = yield* HttpServer.HttpServer;
    if (address._tag !== 'TcpAddress') return;

    yield* Console.log(formatNetworkAddressBanner(address.port, networkInterfaces()));
  }),
);
