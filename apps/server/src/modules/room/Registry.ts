import { Context, Effect, Layer, SynchronizedRef } from 'effect';

import type { RegistryState } from './Model';

export class RoomRegistry extends Context.Service<RoomRegistry>()('@tether/server/room/Registry', {
  make: Effect.gen(function* () {
    const ref = yield* SynchronizedRef.make<RegistryState>(new Map());

    const modify = Effect.fnUntraced(function* <A, E>(
      transaction: (state: RegistryState) => Effect.Effect<A, E>,
    ) {
      return yield* SynchronizedRef.modifyEffect(ref, (state) => {
        const nextState = new Map(state);
        return transaction(nextState).pipe(Effect.map((value) => [value, nextState] as const));
      });
    });

    return { modify };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
