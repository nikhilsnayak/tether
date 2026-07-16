import { AppRpcs, AppSignalingRpcs } from '@tether/contracts';
import { Layer } from 'effect';
import { RpcServer } from 'effect/unstable/rpc';

import { RoomHandlers, RoomSignalingHandlers } from './modules/room/Handlers';
import { RoomService } from './modules/room/RoomService';

const SignalingRpcLive = RpcServer.layer(AppSignalingRpcs).pipe(
  Layer.provide(RoomSignalingHandlers),
  Layer.provide(RpcServer.layerProtocolWebsocket({ path: '/rpc/signaling' })),
);

const GenericRpcLive = RpcServer.layer(AppRpcs).pipe(
  Layer.provide(RoomHandlers),
  // RpcClient posts its empty relative request path as a trailing slash.
  Layer.provide(RpcServer.layerProtocolHttp({ path: '/rpc/' })),
);

export const RpcLive = Layer.mergeAll(SignalingRpcLive, GenericRpcLive).pipe(
  Layer.provide(RoomService.layer),
);
