import { Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http';
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc';

import { RpcLive } from './Rpc';

const HealthRoute = HttpRouter.add('GET', '/health', HttpServerResponse.text('OK'));

export const AppLayer = Layer.mergeAll(RpcLive, HealthRoute).pipe(
  Layer.provide(RpcServer.layerProtocolWebsocket({ path: '/rpc' })),
  Layer.provide(RpcSerialization.layerJson),
);
