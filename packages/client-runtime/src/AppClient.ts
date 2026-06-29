import { AppRpcs } from '@tether/contracts';
import { Context, Layer } from 'effect';
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc';
import { Socket } from 'effect/unstable/socket';

export class AppClient extends Context.Service<AppClient>()('AppClient', {
  make: RpcClient.make(AppRpcs),
}) {
  static readonly layer = (url: string) =>
    Layer.effect(this, this.make).pipe(
      Layer.provide(RpcClient.layerProtocolSocket()),
      Layer.provide(Socket.layerWebSocket(url)),
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
      Layer.provide(RpcSerialization.layerJson),
    );
}
