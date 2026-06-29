import { Config, Effect, Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http';
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc';

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

export const AppLayer = Layer.mergeAll(RpcLive, HealthRoute, CorsLive).pipe(
  Layer.provide(RpcServer.layerProtocolWebsocket({ path: '/rpc' })),
  Layer.provide(RpcSerialization.layerJson),
);
