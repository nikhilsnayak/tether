import { Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http';
import { RpcSerialization } from 'effect/unstable/rpc';

import { RpcLive } from './Rpc';

const HealthRoute = HttpRouter.add('GET', '/health', HttpServerResponse.text('OK'));
const Cors = HttpRouter.cors();

export const AppLayer = Layer.mergeAll(RpcLive, HealthRoute, Cors).pipe(
  Layer.provide(RpcSerialization.layerJson),
);
