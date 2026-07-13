import {
  RoomId,
  type DisplayName,
  type PeerId,
  type RoomTemplateId,
} from '@tether/contracts/modules/room';
import { Context, Effect, Layer } from 'effect';

import { RoomAdmission } from './Admission';
import { RoomMembership } from './Membership';
import { RoomRegistry } from './Registry';
import { RoomSignaling } from './Signaling';

export class RoomService extends Context.Service<RoomService>()('@tether/RoomService', {
  make: Effect.gen(function* () {
    const membership = yield* RoomMembership;
    const admission = yield* RoomAdmission;
    const signaling = yield* RoomSignaling;

    const host = Effect.fn('@tether/RoomService.host')(function* (
      selfId: PeerId,
      roomTemplateId: RoomTemplateId,
    ) {
      const resource = yield* Effect.acquireRelease(
        membership.openHost(selfId, roomTemplateId),
        (opened) => membership.removeMember(opened.roomId, selfId),
      );
      return resource.events;
    });

    const getRoomMetadata = Effect.fn('@tether/RoomService.getRoomMetadata')(function* (
      roomId: RoomId,
    ) {
      return yield* membership.getRoomMetadata(roomId);
    });

    const join = Effect.fn('@tether/RoomService.join')(function* (
      roomId: RoomId,
      selfId: PeerId,
      displayName: DisplayName,
    ) {
      return yield* Effect.acquireRelease(admission.openJoin(roomId, selfId, displayName), () =>
        membership.removeMember(roomId, selfId),
      );
    });

    const respondToJoin = Effect.fn('@tether/RoomService.respondToJoin')(function* (
      roomId: RoomId,
      selfId: PeerId,
      sessionToken: string,
      peerId: PeerId,
      decision: 'allow' | 'deny',
    ) {
      return yield* admission.respondToJoin(roomId, selfId, sessionToken, peerId, decision);
    });

    const leave = Effect.fn('@tether/RoomService.leave')(function* (
      roomId: RoomId,
      selfId: PeerId,
      sessionToken: string,
    ) {
      yield* membership.removeMember(roomId, selfId, sessionToken);
    });

    return { host, getRoomMetadata, join, respondToJoin, sendSignal: signaling.sendSignal, leave };
  }),
}) {
  // Leaves Crypto.Crypto as an open requirement; the composition root and tests
  // provide the platform implementation (see lib/ServerCrypto).
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(
      Layer.mergeAll(RoomMembership.layer, RoomAdmission.layer, RoomSignaling.layer).pipe(
        Layer.provide(RoomRegistry.layer),
      ),
    ),
  );
}
