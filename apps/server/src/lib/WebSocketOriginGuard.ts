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
    const origin = request.headers.origin;

    // Origin is only trustworthy (and always present) in browsers. Native
    // clients omit it and could spoof it anyway, so absence passes.
    if (path === '/rpc' && origin !== undefined && !allowedOrigins.includes(origin)) {
      return HttpServerResponse.empty({ status: 403 });
    }

    return yield* httpEffect;
  });
