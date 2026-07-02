import { Rpc, RpcGroup } from 'effect/unstable/rpc';

import {
  LeaveRoomPayload,
  OpenRoomSessionError,
  OpenRoomSessionPayload,
  OpenRoomSessionSuccess,
  SendSignalError,
  SendSignalPayload,
} from './Schemas';

const OpenRoomSessionRpc = Rpc.make('OpenRoomSession', {
  stream: true,
  payload: OpenRoomSessionPayload,
  success: OpenRoomSessionSuccess,
  error: OpenRoomSessionError,
});

const SendSignalRpc = Rpc.make('SendSignal', {
  payload: SendSignalPayload,
  error: SendSignalError,
});

const LeaveRoomRpc = Rpc.make('LeaveRoom', {
  payload: LeaveRoomPayload,
});

export const RoomRpcs = RpcGroup.make(OpenRoomSessionRpc, SendSignalRpc, LeaveRoomRpc);
