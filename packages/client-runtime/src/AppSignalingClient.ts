import { AppSignalingRpcs } from '@tether/contracts';
import { Context, Layer } from 'effect';
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc';
import { Socket } from 'effect/unstable/socket';

/** Ordered session RPC client served over WebSocket at `/rpc/signaling`. */
export class AppSignalingClient extends Context.Service<AppSignalingClient>()(
  'AppSignalingClient',
  {
    make: RpcClient.make(AppSignalingRpcs),
  },
) {
  static readonly layer = (url: string) =>
    Layer.effect(this, this.make).pipe(
      Layer.provide(RpcClient.layerProtocolSocket()),
      Layer.provide(Socket.layerWebSocket(url)),
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
      Layer.provide(RpcSerialization.layerJson),
    );
}
