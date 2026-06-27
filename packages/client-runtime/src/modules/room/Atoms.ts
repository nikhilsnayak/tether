import type { PeerId, RoomId } from '@tether/contracts/modules/room';
import { Effect, Stream } from 'effect';
import { Atom } from 'effect/unstable/reactivity';

import { AppClient } from '../../AppClient';

export interface OpenRoomSessionInput {
  readonly selfId: PeerId;
  readonly roomId: RoomId;
}

export const openRoomSessionAtom = Atom.family((input: OpenRoomSessionInput) =>
  AppClient.runtime.atom(
    Stream.unwrap(AppClient.use((client) => Effect.succeed(client('OpenRoomSession', input)))).pipe(
      Stream.map(({ event }) => event),
    ),
  ),
);

export const sendSignalAtom = AppClient.mutation('SendSignal');
