import { AppRpcs } from '@tether/contracts';
import { Layer } from 'effect';
import { RpcServer } from 'effect/unstable/rpc';

import { RoomHandlers } from './modules/room/Handlers';
import { RoomService } from './modules/room/RoomService';

export const RpcLive = RpcServer.layer(AppRpcs).pipe(
  Layer.provide(RoomHandlers),
  Layer.provide(RoomService.layer),
);
