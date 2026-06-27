import { NodeHttpServer } from '@effect/platform-node';
import { assert, describe, it } from '@effect/vitest';
import { AppRpcs } from '@tether/contracts';
import {
  PeerId,
  PeerJoinedEvent,
  PeerLeftEvent,
  PeerNotInRoom,
  RoomId,
  SignalReceivedEvent,
} from '@tether/contracts/modules/room';
import { Deferred, Effect, Fiber, Layer, Stream } from 'effect';
import { HttpClient, HttpClientRequest, HttpRouter } from 'effect/unstable/http';
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc';

import { AppLayer } from '../src/App';

const roomId = RoomId.make('integration-room');
const alice = PeerId.make('integration-alice');
const bob = PeerId.make('integration-bob');
const mallory = PeerId.make('integration-mallory');

const TestServer = HttpRouter.serve(AppLayer, {
  disableListenLog: true,
  disableLogger: true,
});

const HttpLive = RpcClient.layerProtocolHttp({
  url: '',
  transformClient: HttpClient.mapRequest(HttpClientRequest.appendUrl('/rpc')),
}).pipe(
  Layer.provideMerge(TestServer),
  Layer.provide([NodeHttpServer.layerTest, RpcSerialization.layerNdjson]),
);

describe('RpcHttp', { timeout: 10_000 }, () => {
  it.effect('streams room events and propagates cancellation over HTTP', () =>
    Effect.gen(function* () {
      const client = yield* RpcClient.make(AppRpcs);
      const aliceSawBob = yield* Deferred.make<void>();

      const aliceFiber = yield* client.JoinRoom({ roomId, selfId: alice }).pipe(
        Stream.tap(({ event }) =>
          event._tag === '@tether/PeerJoinedEvent' && event.peerId === bob
            ? Deferred.succeed(aliceSawBob, undefined)
            : Effect.void,
        ),
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true }),
      );
      const bobFiber = yield* client
        .JoinRoom({ roomId, selfId: bob })
        .pipe(Stream.runDrain, Effect.forkChild({ startImmediately: true }));

      yield* Deferred.await(aliceSawBob);
      yield* client.SendSignal({
        roomId,
        selfId: bob,
        signal: { type: 'answer', sdp: 'integration-answer' },
      });
      yield* Fiber.interrupt(bobFiber);

      const events = yield* Fiber.join(aliceFiber);

      assert.deepStrictEqual(events, [
        { event: new PeerJoinedEvent({ peerId: bob }) },
        {
          event: new SignalReceivedEvent({
            peerId: bob,
            signal: { type: 'answer', sdp: 'integration-answer' },
          }),
        },
        { event: new PeerLeftEvent({ peerId: bob }) },
      ]);
    }).pipe(Effect.provide(HttpLive)),
  );

  it.effect('preserves typed RPC errors over HTTP', () =>
    Effect.gen(function* () {
      const client = yield* RpcClient.make(AppRpcs);

      const error = yield* client
        .SendSignal({
          roomId,
          selfId: mallory,
          signal: { type: 'offer', sdp: 'not-in-room' },
        })
        .pipe(Effect.flip);

      assert.instanceOf(error, PeerNotInRoom);
      assert.strictEqual(error.roomId, roomId);
      assert.strictEqual(error.peerId, mallory);
    }).pipe(Effect.provide(HttpLive)),
  );
});
