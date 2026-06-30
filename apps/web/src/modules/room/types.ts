import type { PeerId, RoomId } from '@tether/contracts/modules/room';

export interface RoomSession {
  roomId: RoomId;
  selfId: PeerId;
}
