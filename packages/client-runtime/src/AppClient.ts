import { AppRpcs } from '@tether/contracts';
import { Context, Layer } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc';

export class AppClient extends Context.Service<AppClient>()('AppClient', {
  make: RpcClient.make(AppRpcs),
}) {
  static readonly layer = (endpoint: string) =>
    Layer.effect(this, this.make).pipe(
      Layer.provide(RpcClient.layerProtocolHttp({ url: `${endpoint}/rpc` })),
      Layer.provide(RpcSerialization.layerNdjson),
      Layer.provide(FetchHttpClient.layer),
    );
}
