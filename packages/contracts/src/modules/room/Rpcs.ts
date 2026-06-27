import { Rpc, RpcGroup } from 'effect/unstable/rpc';

import {
  JoinRoomError,
  JoinRoomPayload,
  JoinRoomSuccess,
  SendSignalError,
  SendSignalPayload,
} from './Schemas';

const JoinRoomRpc = Rpc.make('JoinRoom', {
  stream: true,
  payload: JoinRoomPayload,
  success: JoinRoomSuccess,
  error: JoinRoomError,
});

const SendSignalRpc = Rpc.make('SendSignal', {
  payload: SendSignalPayload,
  error: SendSignalError,
});

export const RoomRpcs = RpcGroup.make(JoinRoomRpc, SendSignalRpc);
