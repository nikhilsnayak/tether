import { Rpc, RpcGroup } from 'effect/unstable/rpc';

import { RoomNotFound } from './Errors';
import {
  GetRoomMetadataPayload,
  GetRoomMetadataSuccess,
  LeaveRoomPayload,
  OpenRoomSessionError,
  OpenRoomSessionPayload,
  OpenRoomSessionSuccess,
  RespondToJoinError,
  RespondToJoinPayload,
  SendSignalError,
  SendSignalPayload,
} from './RpcSchemas';

const OpenRoomSessionRpc = Rpc.make('OpenRoomSession', {
  stream: true,
  payload: OpenRoomSessionPayload,
  success: OpenRoomSessionSuccess,
  error: OpenRoomSessionError,
});

const GetRoomMetadataRpc = Rpc.make('GetRoomMetadata', {
  payload: GetRoomMetadataPayload,
  success: GetRoomMetadataSuccess,
  error: RoomNotFound,
});

const RespondToJoinRpc = Rpc.make('RespondToJoin', {
  payload: RespondToJoinPayload,
  error: RespondToJoinError,
});

const SendSignalRpc = Rpc.make('SendSignal', {
  payload: SendSignalPayload,
  error: SendSignalError,
});

const LeaveRoomRpc = Rpc.make('LeaveRoom', {
  payload: LeaveRoomPayload,
});

export const RoomRpcs = RpcGroup.make(
  OpenRoomSessionRpc,
  GetRoomMetadataRpc,
  RespondToJoinRpc,
  SendSignalRpc,
  LeaveRoomRpc,
);
