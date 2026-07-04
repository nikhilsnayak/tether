import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { websocketOriginGuard } from './WebSocketOriginGuard';

const allowedOrigin = 'https://tether.example';
const next = Effect.succeed(HttpServerResponse.empty({ status: 204 }));

const runRequest = (url: string, origin?: string) =>
  websocketOriginGuard([allowedOrigin])(next).pipe(
    Effect.provideService(
      HttpServerRequest.HttpServerRequest,
      HttpServerRequest.fromWeb(
        new Request(url, {
          headers: {
            host: new URL(url).host,
            ...(origin === undefined ? undefined : { origin }),
          },
        }),
      ),
    ),
  );

describe('websocketOriginGuard', () => {
  it.effect('allows the configured origin on the RPC endpoint', () =>
    Effect.gen(function* () {
      const response = yield* runRequest('https://server.example/rpc', allowedOrigin);
      assert.strictEqual(response.status, 204);
    }),
  );

  it.effect('rejects an untrusted origin on the RPC endpoint', () =>
    Effect.gen(function* () {
      const response = yield* runRequest('https://server.example/rpc', 'https://evil.example');
      assert.strictEqual(response.status, 403);
    }),
  );

  it.effect('allows a missing origin on the RPC endpoint for non-browser clients', () =>
    Effect.gen(function* () {
      const response = yield* runRequest('https://server.example/rpc');
      assert.strictEqual(response.status, 204);
    }),
  );

  // React Native's WebSocket sends Origin derived from the endpoint URI.
  it.effect("allows the endpoint's own origin on the RPC endpoint", () =>
    Effect.gen(function* () {
      const response = yield* runRequest('https://server.example/rpc', 'https://server.example');
      assert.strictEqual(response.status, 204);
    }),
  );

  it.effect('does not apply the RPC origin policy to other routes', () =>
    Effect.gen(function* () {
      const response = yield* runRequest('https://server.example/health');
      assert.strictEqual(response.status, 204);
    }),
  );
});
