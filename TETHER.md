# Tether — project spec & handoff

> A private, 1:1 channel between you and one other person: video-call them, and
> (later) share what's on your screen so you can watch something together.
> Built to learn **Effect** (and raw **WebRTC**) on Nikhil's
> `turborepo-effect-starter` monorepo.

---

## 1. What it is

The product, stripped to its essence:

> **a private, intimate channel between you and one other person** — call them,
> and optionally share what's on your screen.

The video call and the "watch-along" are **not two products**. They are two
features on the **same one-to-one WebRTC connection**. A peer connection carries
multiple tracks — camera + mic now, and a shared movie is just _one more track_
added to that same connection later.

Therefore:

- **v0 = a private 1:1 video/audio call.** Stands on its own as a complete,
  useful app even if nothing else is ever added.
- **watch-along = add a `captureStream()` track** to the connection v0 already
  built.

So v0 is identical whether Tether stays "a private calling app" or grows into
"watch together." Building the call first serves both futures.

## 2. Goals & constraints

- **Primary goal:** experiment with / learn **everything** — especially Effect.
  The Effect learning lives in the **signaling server** (rooms, PubSub, Scope,
  fibers, Schema'd protocol), not in WebRTC itself.
- **Secondary:** genuinely useful in daily life (calling a specific person).
- **Cost: zero.** WebRTC media is peer-to-peer (never touches the server), so no
  media-server cost. Signaling server is tiny (Bun on a free tier or localhost).
  STUN is free (Google). TURN is the _only_ possible cost — add it **only if** a
  real connection fails (free tiers exist, e.g. metered.ca; or self-host coturn
  later).
- **WebRTC: raw, by hand** ("raw-dog it") — deliberate learning rep. 1:1 is the
  tractable case (no SFU/mesh/simulcast). If it ever eats weeks, fall back to
  LiveKit (open-source, self-hostable) and move on — but the intent is to learn
  the fundamentals: offer/answer, ICE, STUN/TURN, perfect negotiation,
  multi-track.

## 3. Roles & platforms (decided)

- **Host:** **web** — loads a local file, `captureStream()` → WebRTC track, plus
  cam/mic. (`captureStream` from a file is a clean **web-only** API — this is why
  the host is web.)
- **Viewer:** **web _or_ mobile** — receives the stream + cam/mic. Receiving is
  the easy path on every platform, so mobile-as-viewer is in scope for v0/v1.
- **Server:** Effect signaling relay (2-person room).

### Deliberately deferred (with reasons)

- **Mobile as _host_ of a local file:** hard. React Native (`react-native-webrtc`)
  has **no `captureStream()`-from-file equivalent**; a mobile host would have to
  **screen-share** (Android `MediaProjection` / iOS `ReplayKit`) instead. That's a
  meatier, later rep.
- **PlayerAdapter abstraction:** **skipped on purpose (YAGNI).** Build the local
  video case directly. The future YouTube/Netflix support is a deliberate
  refactor opportunity (good practice tackling a real refactor).
- **YouTube / Netflix / Prime sources:** later.
  - YouTube is uniquely embeddable (public IFrame Player API) → future
    `PlayerAdapter` + sync engine (each plays their own copy; no DRM issue).
  - Netflix/Prime/Disney+ have **no embeddable player + DRM**. The only viable
    path is a **browser extension** that hooks the native `<video>` on their
    site (the Teleparty model) — desktop-only, each needs their own subscription.
    The Effect core (protocol + relay + sync) would be **reused**; only the
    player-control adapter changes.
- **Watch-along / synced playback engine:** not needed for v0 (the v0 call has no
  shared content). When watch-along arrives via screen/file streaming (Model 2,
  "only host has the file"), it needs **no sync engine** — it's the same pixels.
  (A sync engine is only needed for the "both have the file / YouTube" model.)

## 4. Name

**Tether** — you and one person, connected; call them, share your screen.
Content-agnostic, connection-centric, fits both "call" and "watch together."
(Runners-up considered: Beam, Nook, Orbit, Koine, Synema — "Synema" rejected for
implying movies-only.)

---

## 5. Tech stack (Nikhil's `turborepo-effect-starter`)

Monorepo at `/home/nikhils/.personal/tether` (its own git repo). Bun +
Turborepo. **Effect 4 (beta, `^4.0.0-beta.90`)**, React 19, TypeScript 6,
Tailwind v4, oxlint/oxfmt.

```
apps/
  server/   Bun + @effect/platform-bun + Effect RPC over HTTP/NDJSON
  web/      Vite 8 + TanStack Router + Tailwind v4 + React Compiler + @effect/atom-react
  mobile/   Expo 56 + expo-router + @effect/atom-react + react-native 0.85
packages/
  contracts/      shared Effect Schema + @effect/rpc definitions; exports ./modules/*
  client-runtime/ shared client (AppClient, Atoms per module); exports ./modules/*
  ui/             shared React components (button, input, field, toast, ...)
```

### Architecture pattern: **`@effect/rpc`, vertical feature-slices**

A feature = one `module` replicated across packages. The example slice is `todo`.
To add a feature you mirror its files:

- `packages/contracts/src/modules/<m>/Schemas.ts` — `Schema` types, branded ids
  (e.g. `Schema.String.check(Schema.isUUID(7)).pipe(Schema.brand('TodoId'))`),
  tagged errors (`Schema.TaggedErrorClass`).
- `packages/contracts/src/modules/<m>/Rpcs.ts` — `RpcGroup.make(Rpc.make('name',
{ payload, success, error }), ...)`. Streaming responses are supported by
  `@effect/rpc` (relevant for signaling — see §7).
- `packages/contracts/src/modules/<m>/index.ts` — re-exports.
- Register in `packages/contracts/src/AppRpcs.ts` (currently `AppRpcs = RoomRpcs`;
  merge groups once there is more than one feature).
- `apps/server/src/modules/<m>/Handlers.ts` — `XRpcs.toLayer(Effect.gen(...))`,
  provides the service layer.
- `apps/server/src/modules/<m>/<X>Service.ts` — `Context.Service` business logic.
- `apps/server/src/modules/<m>/<X>Repository.ts` — DB access (Drizzle) if needed.
- Wire into `apps/server/src/Rpc.ts`: `RpcServer.layer(AppRpcs).pipe(Layer.provide(...))`.
- `packages/client-runtime/src/modules/<m>/Atoms.ts` + `index.ts` — `@effect/atom-react`.
- `apps/web/src/modules/<m>/components/*` + a route in `apps/web/src/routes/`.
- `apps/mobile/src/modules/<m>/components/*`.

### Key conventions observed

- Imports use `effect/unstable/...` (e.g. `effect/unstable/rpc`,
  `effect/unstable/http`) — this is Effect 4 beta layout.
- Services: `class X extends Context.Service<X>()('<id>', { make: Effect.gen ... })
{ static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(deps)) }`.
- Errors: client-visible domain errors are `Schema.TaggedErrorClass` values in
  the RPC error schema.
- `apps/server/src/App.ts` exports the side-effect-free `AppLayer` =
  `Layer.mergeAll(RpcLive, HealthRoute, CorsLive)` provided with
  `RpcServer.layerProtocolHttp({ path: '/rpc' })` + `RpcSerialization.layerNdjson`
  and is served by `apps/server/src/index.ts` on Bun. Port defaults to `8008`;
  CORS defaults to `http://localhost:5173`.
- v0 has no DB. Rooms and subscriptions are ephemeral in-memory state.

---

## 6. v0 scope (what to build first)

A new `room` (signaling) feature-slice. **No DB, no adapter, no sync engine.**
Smallest thing that teaches the Effect signaling server **and** raw WebRTC.

1. ✅ **`contracts` — signaling protocol** (`packages/contracts/src/modules/room/`):
   - Two RPCs: `OpenRoomSession { selfId, roomId }` (**streaming** → acknowledges
     the session and pushes `RoomEvent`s) and
     `SendSignal { selfId, roomId, signal }` (unary, with membership validation).
   - `RoomEvent` union: `RoomSessionOpenedEvent { peerId: PeerId | null }`,
     `PeerJoinedEvent { peerId }`, `PeerLeftEvent { peerId }`, and
     `SignalReceivedEvent { peerId, signal }`.
   - `Signal { type: 'offer' | 'answer', sdp }`. **ICE not modeled yet** — will
     extend `Signal` into a tagged union (`description | candidate`) when the web
     client needs it (WebRTC concept #2).
   - Typed client errors: `RoomFull`, `PeerAlreadyJoined`, and `PeerNotInRoom`.
   - **Terminology (ratified):** `selfId` = me (client→server payloads only),
     `peerId` = the other peer (server→client events only). The server turns a
     sender's `selfId` into the recipient's `peerId`.
   - 2-person room (max 2 participants).
2. ✅ **`apps/server` — `Room` relay (the Effect learning):**
   - ✅ **`RoomService.ts`** — in-memory `Map<RoomId, { members, pubsub }>` behind a
     `SynchronizedRef`. `openSession` atomically creates a subscription before
     exposing membership, rejects duplicate peers and rooms over capacity, and
     returns a complete `Stream<RoomEvent>` beginning with
     `RoomSessionOpenedEvent` followed by live events. `Effect.acquireRelease`
     owns disconnect cleanup, publishes `PeerLeft`, and GCs empty rooms.
     `sendSignal` atomically validates membership before publishing. `leave` and
     the underlying `PubSub` stay private.
   - ✅ **`Handlers.ts`** — transport adapter only: maps the domain event stream to
     RPC `{ event }` responses and delegates `SendSignal` to the service.
   - ✅ **`Rpc.ts` / `App.ts`** — handlers, service, `/rpc` HTTP protocol, and NDJSON
     serialization are wired into the server.
   - ✅ **Tests** — 13 service/handler tests plus 2 real HTTP/NDJSON integration
     tests in `apps/server/integrations/`, covering streaming, cancellation,
     typed wire errors, capacity, duplicate peers, and membership validation.
3. ⬜ **`apps/web` — two tabs, raw `RTCPeerConnection`:**
   - Both sides send **camera + mic**.
   - Perfect-negotiation handshake (polite/impolite peer) over the signaling
     channel; free Google STUN; no TURN yet.
   - Connection-status atoms via `@effect/atom-react`.

**Done = two browser tabs (or two laptops) on a private 1:1 video/audio call.**

### Then (post-v0, roughly in order)

- v1: **mobile viewer** (Expo + `react-native-webrtc`, receive-only is easy).
- v2: **watch-along** = add a `captureStream()` track from a local file on the
  web host to the existing peer connection (Model 2 — no sync engine needed).
- later: TURN if needed; PlayerAdapter refactor; YouTube adapter; Netflix via
  browser extension.

---

## 7. ✅ RESOLVED: signaling transport

WebRTC signaling needs the server to **push** the other peer's offer/answer/ICE
unsolicited. **Decision: stay entirely in the `@effect/rpc` world over the
existing HTTP NDJSON protocol — no WebSocket.**

- `OpenRoomSession` is a **streaming RPC** (`stream: true`): the first event
  acknowledges that membership is active and provides the existing peer, then
  the server pushes `RoomEvent`s for the life of the connection (SSE-equivalent
  over HTTP/ndjson). The held-open stream **is** both the room-session lifetime
  and realtime channel.
- `SendSignal` is a separate **unary RPC** for messages going up.
- Proven by the HTTP integration suite: server→client streaming, cancellation,
  and typed errors work over `layerProtocolHttp` + `layerNdjson`. No WebSocket or
  custom protocol layer is needed.

**Consequences this shaped:**

- `OpenRoomSession` (a stream) and `SendSignal` (a separate request) are
  **independent HTTP calls with no session glue**, so the client must
  **self-identify in every message** (`selfId`) — that's why the client mints its
  own `PeerId`.
- **Echo:** a `PubSub` broadcasts to all subscribers including the sender, so
  `RoomService` filters each subscriber's own events from its domain stream.
- **Identity boundary:** protocol membership is enforced, but `selfId` is still
  client-provided. Trusted user identity and protection against impersonating an
  existing peer are deferred until platform authentication is introduced.
- **Scale note:** held-open streams are cheap on an event-loop server (a fiber
  parked on a `PubSub` is ~zero CPU). The real ceiling is single-process
  in-memory `PubSub` (would need Redis/NATS to scale horizontally) — YAGNI at
  Tether's 1:1 scale.

---

## 8. Where things are

- This project (`tether`): `/home/nikhils/.personal/tether` (own git repo). Copied
  from the starter; package scope renamed `@turborepo-effect-starter/*` →
  `@tether/*`, and the example slices were removed. **Current state:** room
  contracts, scoped server service, RPC handlers, HTTP/NDJSON wiring, typed
  errors, unit tests, and integration tests are complete and typecheck clean.
  **Next:** use `@tether/client-runtime/modules/room` to consume
  `OpenRoomSession` and `SendSignal`, then implement the web
  `RTCPeerConnection` client.
- Source template (reference only): `/home/nikhils/.personal/turborepo-effect-starter`.
- Reference example slice to mirror: the **`todo`** module across all packages.
