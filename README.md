# Tether

A private, 1:1 channel between you and one other person: video-call them, and
(later) share what's on your screen so you can watch something together.

**This is a learning project.** The point isn't to ship a calling app — it's to
learn **Effect 4** and **WebRTC** by building something real end to end. The
product is genuinely useful (a private call with someone specific), but every
design choice is made to maximize what there is to learn, not to reach a feature
count fastest.

## What I'm learning

- **WebRTC, by hand.** No LiveKit, no SDK wrapper — the offer/answer handshake,
  ICE, STUN, renegotiation, and multi-track are all wired up directly. 1:1 is
  chosen deliberately because it's the tractable case (no SFU/mesh/simulcast),
  which keeps the fundamentals in view instead of hiding them behind a library.
- **Effect 4.** Modelling a stateful, concurrent, callback-driven protocol as a
  single serialized actor over a merged stream; scoped resource ownership
  (`Scope`) for connection/listener lifecycles; streaming RPC (`@effect/rpc`)
  for the signaling channel; tagged errors and `Layer`-based dependency wiring.
- **Where the two meet.** Adapting messy browser WebRTC callbacks into a clean,
  platform-neutral Effect workflow — and keeping that core free of React and DOM
  so the same actor could later drive a mobile client.

If you're reading the code to learn, the two places to start are
`apps/server/src/modules/room` (the Effect signaling relay) and
`packages/client-runtime/src/modules/room` (the peer-session actor). Both are
commented with the "why," not just the "what."

## Status

**v0 is working.** Two browser tabs (or two laptops) can hold a private 1:1
video/audio call with in-band text chat, over a peer-to-peer WebRTC connection.
Signaling, STUN/TURN ICE configuration, camera/mic media, and
reconnection/stall handling are all in place.

The call and a future "watch-along" are not two products — they're two features
on the same peer connection. A shared movie is just one more track added later.

## Tech stack

Bun + Turborepo. Effect 4 (beta), React 19, TypeScript 6, Tailwind v4,
oxlint/oxfmt.

```
apps/
  server/   Bun + @effect/platform-bun + Effect RPC over WebSocket/JSON
  web/      Vite + TanStack Router + Tailwind v4 + React Compiler + @effect/atom-react
  mobile/   Expo + expo-router + @effect/atom-react (viewer, planned)
packages/
  contracts/       shared Effect Schema + @effect/rpc definitions
  client-runtime/  React-free RPC client + platform-neutral peer-session actor
  ui/              shared React components
e2e/               Playwright end-to-end tests
```

## Getting started

```sh
bun install
bun run dev          # runs server (:8008) + web (:5173)
```

Open two tabs at `http://localhost:5173`, join the same room, and you're on a
call. WebRTC media is peer-to-peer — it never touches the server.

### Checks

```sh
bun run lint         # oxlint
bun run fmt:check    # oxfmt
bun run test         # unit (vitest) + e2e (playwright)
```

CI runs all three on push to `main` and on PRs targeting `main`
(`.github/workflows/ci.yml`).

## How it works

### Signaling (`apps/server`)

WebRTC needs a server to relay the other peer's offer/answer/ICE. Tether stays
entirely in the `@effect/rpc` world over a WebSocket with JSON serialization:

- **`OpenRoomSession`** — a streaming RPC. The held-open stream _is_ both the
  room-session lifetime and the realtime server→client channel: its first event
  confirms membership and reports the existing peer, then it pushes `RoomEvent`s.
- **`SendSignal`** — a unary RPC for offer/answer/ICE going up.
- **`LeaveRoom`** — an idempotent unary RPC for deliberate departures; stream
  cancellation is the fallback for abrupt disconnects.

The relay is an in-memory `Map<RoomId, { members, pubsub }>` behind a
`SynchronizedRef` — 2 participants per room, ephemeral, no DB. Each client
self-identifies with a `selfId` it mints. On join, the server issues a private
session token required for signaling and explicit leave operations, then
rewrites a sender's `selfId` into the recipient's `peerId`. Signaling is
limited per member to a burst of 50 messages and a sustained 5 messages/second;
the server also caps concurrently live rooms at 1,000.

`GetIceServers` serves the browser's ICE configuration. `STUN_URLS` accepts a
comma-separated list and defaults to Google's public STUN service. Set
`TURN_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL` together to append a TURN
relay. TURN credentials are delivered to signaling clients but are currently
static operator-managed secrets.

### Peer session (`packages/client-runtime`)

`packages/client-runtime/src/modules/room` owns the handshake and chat rules and
has no React, DOM, or browser dependency. The app supplies threxport const SIGNAL_BUCKET_CAPACITY = 50;
const SIGNAL_BUCKET_REFILL_EVERY = Duration.millis(200);
export const MAX_LIVE_ROOMS = 1000;ee Effect
services: `AppClient` (signaling RPCs), `PeerSessionPlatform` (native WebRTC),
and `PeerSessionEventSink` (projecting domain events into UI state).

Room events, WebRTC callbacks, and UI commands are merged into a single stream
consumed by exactly one actor fiber. That serialization is the coordination
guarantee — offer/answer, ICE, channel lifecycle, and chat can't mutate state
concurrently. The role split is deterministic: the first peer in a room waits
and becomes the **answerer**; the second becomes the **offerer**, creates the
chat data channel, and sends the offer.

The camera + microphone stream is acquired once per session and added to each
peer connection before negotiation. A dedicated media scope releases it when
the session actor reaches a terminal state, even if the UI remains mounted to
display that state. A failed connection, closed data channel, or 20s
negotiation deadline replaces only the current connection generation while
signaling stays alive. The actor retries twice, preserving each peer's
offerer/answerer role, before surfacing `TransportLost` or
`NegotiationStalled`. Individual ICE candidates that cannot be applied are
dropped without terminating the session.

### Test coverage

Playwright exercises the complete two-peer call, authenticated signaling and
leave/replacement flow, full-room rejection, TURN configuration propagation,
non-fatal candidate failures, signaling bursts, successful reconnection, and
media release on terminal states. Exact security/resource invariants—token
forgery rejection, per-member bucket accounting, and the 1,000-room boundary—
run against `RoomService` and the real RPC handlers in the server test suite;
they are deterministic boundary tests rather than creating thousands of
browsers.

## Next learning reps

Each of these is picked as much for what it teaches as for what it adds:

- **Mobile viewer** — reuse the platform-neutral actor behind a second platform
  adapter (Expo + `react-native-webrtc`). The test of whether the React/DOM-free
  boundary actually held.
- **Watch-along** — add a `captureStream()` track from a local file to the
  existing peer connection. A rep in multi-track renegotiation; no sync engine
  needed (it's the same pixels).
- **A real refactor** — a `PlayerAdapter` abstraction, deliberately skipped now
  (YAGNI), left as practice for tackling a refactor once a second source exists.
- **Later, if warranted:** ephemeral HMAC TURN credentials, a YouTube adapter
  (embeddable IFrame API), Netflix/Prime via a browser extension (the Teleparty
  model).
