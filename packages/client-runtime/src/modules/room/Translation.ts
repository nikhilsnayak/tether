import type { RoomEvent, RoomId, Signal } from '@tether/contracts/modules/room';

import type { PeerSessionRemoteInput } from '../peer-session/ActorModel';
import type { PeerSessionEvent, PeerSessionSignal } from '../peer-session/Model';

export type RoomEventTranslation = {
  readonly input: PeerSessionRemoteInput | null;
  readonly uiEvent: PeerSessionEvent | null;
  readonly openedSession: { readonly roomId: RoomId; readonly sessionToken: string } | null;
};

const toPeerSessionSignal = (signal: Signal): PeerSessionSignal =>
  signal._tag === '@tether/SessionDescriptionSignal'
    ? {
        _tag: 'SessionDescription',
        type: signal.type,
        sdp: signal.sdp,
        negotiationEpoch: signal.negotiationEpoch,
      }
    : {
        _tag: 'IceCandidate',
        candidate: signal.candidate,
        sdpMid: signal.sdpMid,
        sdpMLineIndex: signal.sdpMLineIndex,
        usernameFragment: signal.usernameFragment,
        negotiationEpoch: signal.negotiationEpoch,
      };

const noTranslation = {
  input: null,
  uiEvent: null,
  openedSession: null,
} satisfies RoomEventTranslation;

export const translateRoomEventData = (event: RoomEvent): RoomEventTranslation => {
  switch (event._tag) {
    case '@tether/RoomSessionOpenedEvent':
      return {
        input: { _tag: 'RoomSessionOpened', peerId: event.peerId },
        uiEvent: { _tag: 'RoomOpened', roomId: event.roomId },
        openedSession: { roomId: event.roomId, sessionToken: event.sessionToken },
      };
    case '@tether/PeerJoinedEvent':
      return {
        ...noTranslation,
        input: { _tag: 'PeerJoined', peerId: event.peerId },
      };
    case '@tether/PeerLeftEvent':
      return {
        ...noTranslation,
        input: { _tag: 'PeerLeft', peerId: event.peerId },
      };
    case '@tether/SignalReceivedEvent':
      return {
        ...noTranslation,
        input: {
          _tag: 'SignalReceived',
          peerId: event.peerId,
          signal: toPeerSessionSignal(event.signal),
        },
      };
    case '@tether/JoinRequestedEvent':
      return {
        ...noTranslation,
        uiEvent: {
          _tag: 'JoinRequestReceived',
          peerId: event.peerId,
          displayName: event.displayName,
        },
      };
    case '@tether/JoinPendingEvent':
      return { ...noTranslation, uiEvent: { _tag: 'JoinPending' } };
    case '@tether/JoinCancelledEvent':
      return {
        ...noTranslation,
        uiEvent: { _tag: 'JoinRequestCancelled', peerId: event.peerId },
      };
  }
};
