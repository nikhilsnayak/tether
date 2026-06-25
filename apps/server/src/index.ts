import { networkInterfaces } from 'node:os';

import { BunHttpServer, BunRuntime } from '@effect/platform-bun';
import { Config, Console, Effect, Layer } from 'effect';
import { HttpRouter, HttpServer, HttpServerResponse } from 'effect/unstable/http';
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc';

import { DbService } from './lib/db';
import { RpcLive } from './Rpc';

const HealthRoute = HttpRouter.add('GET', '/health', HttpServerResponse.text('OK'));

const CorsLive = Layer.unwrap(
  Effect.gen(function* () {
    const origins = yield* Config.string('CORS_ORIGIN').pipe(
      Config.withDefault('http://localhost:5173'),
    );
    return HttpRouter.cors({
      allowedOrigins: origins.split(',').map((origin) => origin.trim()),
    });
  }),
);

const ListenBanner = Layer.effectDiscard(
  Effect.gen(function* () {
    const { address } = yield* HttpServer.HttpServer;
    if (address._tag !== 'TcpAddress') return;
    const lines = [`  ➜  Local:    http://localhost:${address.port}/`];
    for (const iface of Object.values(networkInterfaces()).flat()) {
      if (iface?.family === 'IPv4' && !iface.internal) {
        lines.push(`  ➜  Network:  http://${iface.address}:${address.port}/`);
      }
    }
    yield* Console.log(lines.join('\n'));
  }),
);

const AppLayer = Layer.mergeAll(RpcLive, HealthRoute, CorsLive).pipe(
  Layer.provide(RpcServer.layerProtocolHttp({ path: '/rpc' })),
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(DbService.layer),
);

const HttpLive = HttpRouter.serve(AppLayer, { disableListenLog: true }).pipe(
  Layer.merge(ListenBanner),
  Layer.provide(
    BunHttpServer.layerConfig({
      hostname: Config.string('HOST').pipe(Config.withDefault('0.0.0.0')),
      port: Config.number('PORT').pipe(Config.withDefault(8008)),
    }),
  ),
);

Layer.launch(HttpLive).pipe(BunRuntime.runMain);
