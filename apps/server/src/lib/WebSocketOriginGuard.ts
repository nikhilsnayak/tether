import { Effect } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

export const websocketOriginGuard = (allowedOrigins: ReadonlyArray<string>) =>
  Effect.fnUntraced(function* <E, R>(
    httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  ): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    E,
    R | HttpServerRequest.HttpServerRequest
  > {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const path = request.url.split(/[?#]/, 1)[0];

    if (path === '/rpc' && !allowedOrigins.includes(request.headers.origin ?? '')) {
      return HttpServerResponse.empty({ status: 403 });
    }

    return yield* httpEffect;
  });
