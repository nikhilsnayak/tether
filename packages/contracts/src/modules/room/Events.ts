import { Schema } from 'effect';

import { DisplayName, PeerId, RoomId, RoomTemplateId, SessionToken } from './Identity';
import { Signal } from './Signals';

export class RoomSessionOpenedEvent extends Schema.TaggedClass<RoomSessionOpenedEvent>()(
  '@tether/RoomSessionOpenedEvent',
  {
    peerId: Schema.NullOr(PeerId),
    sessionToken: SessionToken,
    roomId: RoomId,
    roomTemplateId: RoomTemplateId,
  },
) {}

export class JoinRequestedEvent extends Schema.TaggedClass<JoinRequestedEvent>()(
  '@tether/JoinRequestedEvent',
  {
    peerId: PeerId,
    displayName: DisplayName,
  },
) {}

export class JoinPendingEvent extends Schema.TaggedClass<JoinPendingEvent>()(
  '@tether/JoinPendingEvent',
  {},
) {}

// Broadcast to the host when a pending knock is withdrawn before a decision
// (the joiner disconnected or the knock timed out), so the prompt can clear.
export class JoinCancelledEvent extends Schema.TaggedClass<JoinCancelledEvent>()(
  '@tether/JoinCancelledEvent',
  {
    peerId: PeerId,
  },
) {}

export class PeerJoinedEvent extends Schema.TaggedClass<PeerJoinedEvent>()(
  '@tether/PeerJoinedEvent',
  {
    peerId: PeerId,
  },
) {}

export class PeerLeftEvent extends Schema.TaggedClass<PeerLeftEvent>()('@tether/PeerLeftEvent', {
  peerId: PeerId,
}) {}

export class SignalReceivedEvent extends Schema.TaggedClass<SignalReceivedEvent>()(
  '@tether/SignalReceivedEvent',
  {
    peerId: PeerId,
    signal: Signal,
  },
) {}

// Both peers confirmed the direct connection; the server has committed
// detachment and will remove the room silently.
export class DetachedEvent extends Schema.TaggedClass<DetachedEvent>()(
  '@tether/DetachedEvent',
  {},
) {}

export const RoomEvent = Schema.Union([
  RoomSessionOpenedEvent,
  PeerJoinedEvent,
  PeerLeftEvent,
  SignalReceivedEvent,
  JoinRequestedEvent,
  JoinPendingEvent,
  JoinCancelledEvent,
  DetachedEvent,
]);
export type RoomEvent = typeof RoomEvent.Type;
