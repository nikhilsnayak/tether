import { AppRpcs } from '@tether/contracts';
import { Context, Layer } from 'effect';
import { AtomRpc } from 'effect/unstable/reactivity';
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc';
import { Socket } from 'effect/unstable/socket';

export class AppClient extends Context.Service<AppClient>()('AppClient', {
  make: RpcClient.make(AppRpcs),
}) {
  static readonly layer = (url: string) =>
    Layer.effect(this, this.make).pipe(Layer.provide(appClientProtocol(url)));
}

const appClientProtocol = (url: string) =>
  RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(url)),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerJson),
  );

/**
 * Creates the imperative and reactive clients from the same protocol layer.
 */
export const makeAppClientRuntime = (url: string) => {
  const protocol = appClientProtocol(url);
  const layer = Layer.effect(AppClient, AppClient.make).pipe(Layer.provide(protocol));
  const AtomClient = AtomRpc.Service()('AppAtomClient', {
    group: AppRpcs,
    protocol,
  });
  return { AtomClient, layer } as const;
};
