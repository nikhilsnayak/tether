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
    const host = request.headers.host;

    // Origin is only trustworthy (and always present) in browsers. Native
    // clients could spoof it anyway, so absence passes. React Native never
    // omits it though: its WebSocket derives a default Origin from the
    // endpoint itself (wss://host -> https://host), so the server's own
    // origin passes too — no browser page is ever served from this host.
    const selfOrigins = host === undefined ? [] : [`https://${host}`, `http://${host}`];

    if (
      path === '/rpc' &&
      origin !== undefined &&
      !allowedOrigins.includes(origin) &&
      !selfOrigins.includes(origin)
    ) {
      return HttpServerResponse.empty({ status: 403 });
    }

    return yield* httpEffect;
  });
