import type { PeerId, RoomId } from '@tether/contracts/modules/room';

/** Stable identity required to join and signal within one room. */
export interface RoomSession {
  roomId: RoomId;
  selfId: PeerId;
}
