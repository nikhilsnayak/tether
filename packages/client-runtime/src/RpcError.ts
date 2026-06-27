import type { AppRpcs } from '@tether/contracts';
import { Cause, Match, Option } from 'effect';
import type { Rpc, RpcClientError, RpcGroup } from 'effect/unstable/rpc';

type AppError = Rpc.Error<RpcGroup.Rpcs<typeof AppRpcs>> | RpcClientError.RpcClientError;

export function messageForCause<E extends AppError>(cause: Cause.Cause<E>): string {
  return Option.match(Cause.findErrorOption(cause), {
    onNone: () => 'Something went wrong. Please try again.',
    onSome: Match.typeTags<AppError, string>()({
      '@tether/PeerNotInRoom': () => 'You are no longer in this room. Rejoin and try again.',
      RpcClientError: () => "Couldn't reach the server. Check your connection and retry.",
    }),
  });
}
