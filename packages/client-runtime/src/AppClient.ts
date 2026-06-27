import { AppRpcs } from '@tether/contracts';
import { Layer } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { AtomRpc } from 'effect/unstable/reactivity';
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc';

import { serverUrlAtom } from './Config';

export class AppClient extends AtomRpc.Service<AppClient>()('AppClient', {
  group: AppRpcs,
  protocol: (get) =>
    RpcClient.layerProtocolHttp({ url: `${get(serverUrlAtom)}/rpc` }).pipe(
      Layer.provideMerge(RpcSerialization.layerNdjson),
      Layer.provideMerge(FetchHttpClient.layer),
    ),
}) {}
