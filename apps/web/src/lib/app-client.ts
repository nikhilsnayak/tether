import { makePeerSessionSignalingLayer } from '@tether/client-runtime/modules/room';
import { AppRpcs } from '@tether/contracts';
import { Layer } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { AtomRpc } from 'effect/unstable/reactivity';
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc';

export const serverUrl =
  import.meta.env.VITE_SERVER_URL ?? 'https://tether-server.nikhilsnayak.dev';

const rpcUrl = new URL('/rpc', serverUrl);
const signalingUrl = new URL('/rpc/signaling', serverUrl);
signalingUrl.protocol = signalingUrl.protocol === 'https:' ? 'wss:' : 'ws:';

export const peerSessionSignalingLayer = makePeerSessionSignalingLayer(signalingUrl.href);
export class AppAtomClient extends AtomRpc.Service<AppAtomClient>()('AppAtomClient', {
  group: AppRpcs,
  protocol: RpcClient.layerProtocolHttp({ url: rpcUrl.href }).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(RpcSerialization.layerJson),
  ),
}) {}
