# Plan 005: Bind room membership to a server-issued session token

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 63fe051ba..HEAD -- packages/contracts/src/modules/room/ apps/server/src/modules/room/ packages/client-runtime/src/modules/room/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Changes from plans 001–004 in
> `PeerSession.ts` / `PeerSession.test.ts` / `Handlers.ts` / `Rpcs.ts` /
> `Schemas.ts` are expected and fine.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (textual merge conflicts with 003 in
  `Schemas.ts`/`Rpcs.ts`/`Handlers.ts` are likely — land 003 first)
- **Category**: security
- **Planned at**: commit `63fe051ba`, 2026-07-03

## Why this matters

The server trusts any client-supplied `selfId`. Identity is never bound to a
connection, so possession of a `(roomId, selfId)` pair is full authority over
that member. Concretely exploitable today:

- **Kick**: `LeaveRoom { roomId, selfId: victimId }` evicts the victim. Every
  peer learns the other's `selfId` from `PeerJoinedEvent` the moment they
  join — so anyone you've ever called can kick you from any room they know
  you're in.
- **Impersonate**: after kicking you, the attacker can rejoin *as you*
  (`PeerAlreadyJoined` only blocks concurrent presence), and can send forged
  signals in your name via `SendSignal`.

Fix: when a peer opens a room session, the server generates an unguessable
session token and returns it **only to that peer** (inside
`RoomSessionOpenedEvent`, which is never broadcast). `SendSignal` and
`LeaveRoom` then require the token. Knowing someone's `selfId` is no longer
authority over them.

## Current state

Relevant files:

- `packages/contracts/src/modules/room/Schemas.ts` — event and payload
  schemas. Today:

  ```ts
  export class RoomSessionOpenedEvent extends Schema.TaggedClass<RoomSessionOpenedEvent>()(
    '@tether/RoomSessionOpenedEvent',
    { peerId: Schema.NullOr(PeerId) },
  ) {}
  ...
  export const LeaveRoomPayload = Schema.Struct({ selfId: PeerId, roomId: RoomId });
  export const SendSignalPayload = Schema.Struct({ selfId: PeerId, roomId: RoomId, signal: Signal });
  ```

- `apps/server/src/modules/room/RoomService.ts` — in-memory registry:

  ```ts
  type Registry = Map<RoomId, { members: PeerId[]; pubsub: PubSub.PubSub<RoomEvent> }>;
  ```

  `openSession(roomId, selfId)` (lines 56–111) adds the member, publishes
  `PeerJoinedEvent`, and returns a stream that starts with
  `new RoomSessionOpenedEvent({ peerId })` where `peerId` is the *other*
  member or null. **Privacy property to preserve**: the opened event is only
  prepended to the opener's own stream (`Stream.fromArray(initial)`), never
  published to the pubsub — that is why the token may ride on it.
  `sendSignal(roomId, selfId, signal)` (113–133) checks
  `ctx.members.includes(selfId)`. `leave(roomId, selfId)` (22–54) checks the
  same and silently no-ops otherwise.
- `apps/server/src/modules/room/Handlers.ts` — passes payload fields through
  to the service.
- `packages/client-runtime/src/modules/room/PeerSession.ts` — client side:
  - `makePeerSessionActor(session, localStream, dispatchLocalInput)` builds
    `sendSignal = (signal) => client.SendSignal({ ...session, signal })`
    (line 129).
  - `startPeerSession` maps the room stream (lines 698–705):

    ```ts
    const roomInputStream = client.OpenRoomSession(session).pipe(
      Stream.map(({ event }): PeerSessionInput => ({ _tag: 'RoomEvent', event })),
    );
    ```

  - `leave` (lines 788–791): `Effect.runPromise(client.LeaveRoom(session))`.
- Tests: `apps/server/src/modules/room/RoomService.test.ts`,
  `apps/server/src/modules/room/Handlers.test.ts`,
  `packages/client-runtime/src/modules/room/PeerSession.test.ts`.

Threat-model boundary (accepted, do not fix here): a client can still *join*
any room whose `roomId` it knows under any unused `selfId` — room codes are
capability URLs by design. Room-occupancy protection (rate limiting, caps) is
plan 006. This plan only removes authority-via-known-selfId.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install` (repo root) | exit 0 |
| Server tests | `cd apps/server && bun run test` | all pass |
| Client-runtime tests | `cd packages/client-runtime && bun run test` | all pass |
| All tests | `bun run test` (root) | all pass |
| Lint (type-aware) | `bun run lint` (repo root) | exit 0 |
| Format check | `bun run fmt:check` (repo root) | exit 0 |

## Scope

**In scope** (the only files you should modify):

- `packages/contracts/src/modules/room/Schemas.ts`
- `apps/server/src/modules/room/RoomService.ts`
- `apps/server/src/modules/room/RoomService.test.ts`
- `apps/server/src/modules/room/Handlers.ts`
- `apps/server/src/modules/room/Handlers.test.ts`
- `packages/client-runtime/src/modules/room/PeerSession.ts`
- `packages/client-runtime/src/modules/room/PeerSession.test.ts`

**Out of scope** (do NOT touch):

- `packages/contracts/src/modules/room/Rpcs.ts` — no new RPCs; only payload
  schemas change (defined in `Schemas.ts`).
- Authentication of *joining* (accounts, room passwords) — different feature.
- `e2e/**` — the flow is unchanged from the browser's perspective; existing
  e2e tests must keep passing without edits (see done criteria).
- Rate limiting / occupancy caps — plan 006.

## Git workflow

- Branch: `advisor/005-session-token-identity`
- Conventional commits, e.g.
  `feat(security): bind room membership to a server-issued session token`
- Client and server ship from one repo and are deployed together, so the
  breaking wire change needs no compatibility shim — but note it in the
  commit body: `BREAKING: SendSignal/LeaveRoom payloads require sessionToken`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Contracts — add the token to the wire types

In `Schemas.ts`:

1. `RoomSessionOpenedEvent` gains `sessionToken: Schema.String`.
2. `LeaveRoomPayload` and `SendSignalPayload` gain `sessionToken: Schema.String`.

**Verify**: `bun run lint` → fails in server + client-runtime (constructors
and payloads now missing the field). That's the to-do list for the next steps.

### Step 2: Server — issue and verify tokens

In `RoomService.ts`:

1. Change the registry member type from `members: PeerId[]` to

   ```ts
   type Member = { readonly peerId: PeerId; readonly sessionToken: string };
   type Registry = Map<RoomId, { members: Member[]; pubsub: PubSub.PubSub<RoomEvent> }>;
   ```

2. `openSession`: generate the token inside the `modifyEffect` callback —
   `const sessionToken = crypto.randomUUID();` (Bun provides `crypto`
   globally; wrap in `Effect.sync` only if you need effect context, a plain
   expression inside the generator is fine). Membership checks become
   `ctx.members.some((member) => member.peerId === selfId)`; the other-peer
   lookup becomes `ctx.members.find((member) => member.peerId !== selfId)?.peerId ?? null`;
   push `{ peerId: selfId, sessionToken }`; construct
   `new RoomSessionOpenedEvent({ peerId, sessionToken })`.
3. `openSession`'s `Effect.acquireRelease` finalizer currently calls
   `leave(roomId, selfId)` — the *server-side* stream-close cleanup must keep
   working without a token. Split `leave` into a private
   `removeMember(roomId, selfId)` (current body, membership check by
   `peerId` only) used by the finalizer, and a public
   `leave(roomId, selfId, sessionToken)` that only removes when
   `ctx.members.some((m) => m.peerId === selfId && m.sessionToken === sessionToken)`
   — otherwise `Effect.logWarning('Leave rejected').pipe(Effect.annotateLogs('reason', 'invalid-session-token'))`
   and no-op (keep leave idempotent; no new error type).
4. `sendSignal(roomId, selfId, sessionToken, signal)`: the existing
   not-in-room branch (`PeerNotInRoom`) now also triggers when the token
   doesn't match the stored one for `selfId`. Do not add a distinct error —
   an attacker learns nothing from the difference.

In `Handlers.ts`, pass the new payload fields through:
`SendSignal: ... room.sendSignal(roomId, selfId, sessionToken, signal)`,
`LeaveRoom: ... room.leave(roomId, selfId, sessionToken)` (destructure the
extra field from the payloads).

**Verify**: `cd apps/server && bun run test` → existing tests fail only where
they construct members/events without tokens; update them mechanically (any
fixed string is fine as a token in tests). Then all pass.

### Step 3: Client — capture the token, attach it to authenticated calls

In `PeerSession.ts`:

1. Have `makePeerSessionActor` create a `Ref<string>` for the token and return
   it alongside `handleInput`:

   ```ts
   const sessionTokenRef = yield* Ref.make('');
   // ...build handleInput...
   return { handleInput, sessionTokenRef };
   ```

2. In `startPeerSession`, fork an explicit `actorScope`, construct the actor in
   that scope, and close it when the actor loop exits. Keep the room input
   stream as a pure event mapping and run it through `actor.handleInput`.
3. When the actor handles `RoomSessionOpenedEvent`, write `event.sessionToken`
   to its ref before starting offer/answer work. `sendSignal` reads the ref and
   includes the value in its payload. `leave` reads the returned ref and passes
   the value to `LeaveRoom` inside the existing idempotent promise.

**Verify**: `bun run lint` → remaining errors only in
`PeerSession.test.ts` (fixture calls `makePeerSessionActor` with 3 args, and
fixture events lack tokens). Fix mechanically: fixture passes
`() => 'test-session-token'`, fixture `RoomSessionOpenedEvent` constructions
gain `sessionToken: 'test-session-token'`. Then
`cd packages/client-runtime && bun run test` → all pass.

### Step 4: Security regression tests (server)

In `RoomService.test.ts`, modeled on its existing cases:

1. **Kick is dead**: A and B join a room (each receives its own token via its
   opened event). Call `leave(roomId, A, B'sToken)` — wrong token for A.
   Assert A is still a member (e.g. `sendSignal` as A with A's token still
   succeeds, and no `PeerLeftEvent` for A was published to B's stream).
2. **Forged signal is dead**: `sendSignal(roomId, A, 'wrong-token', signal)`
   fails with `PeerNotInRoom`; the same call with A's real token succeeds.
3. **Stream-close cleanup still works**: open a session inside a scope, close
   the scope (interrupt the stream), assert the member is removed (the
   `removeMember` finalizer path — this is the regression guard for Step 2.3).
4. **Tokens are per-member and unguessable-shaped**: A and B receive
   different, non-empty tokens.

In `PeerSession.test.ts`, one addition:

5. **Client echoes the token**: drive a session through the fixture, capture
   the payload the fake `SendSignal` receives, assert
   `sessionToken === 'test-session-token'` (the value delivered in the fixture's
   opened event — make the fixture's dispatch use the *event's* token rather
   than a hardcoded getter if you want this to be end-to-end within the test;
   otherwise assert against the getter value and note it).

## Test plan

Covered by Step 4: 4 new server tests + 1 new client test, plus mechanical
updates to existing fixtures. Exemplars: existing cases in
`RoomService.test.ts` (they already exercise join/signal/leave flows through
the service directly).

Verification: `bun run test` (root) → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run test` (root) exits 0, including the 5 new tests
- [ ] `bun run lint` and `bun run fmt:check` exit 0
- [ ] `grep -n "sessionToken" packages/contracts/src/modules/room/Schemas.ts`
      shows the field on `RoomSessionOpenedEvent`, `LeaveRoomPayload`,
      `SendSignalPayload`
- [ ] `grep -n "randomUUID" apps/server/src/modules/room/RoomService.ts`
      shows server-side generation (clients never mint tokens)
- [ ] `grep -rn "sessionToken" apps/server/src/modules/room/RoomService.ts | grep -i "publish"`
      returns no matches (tokens are never published to the room pubsub)
- [ ] `cd e2e && bun run test` passes unchanged, or — if the e2e environment
      isn't runnable — a manual two-tab smoke test (join, chat, leave)
      succeeds and you note which check you ran
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `RoomSessionOpenedEvent` turns out to be published to the pubsub anywhere
  (it must stay opener-only, or the token leaks to the peer — recheck
  `RoomService.ts:99-104` against the live code).
- The actor does not store the opened event's token before its first
  `SendSignal` — symptom: the first signaling payload carries an empty token.
  Report the observed ordering; don't invent a buffering workaround.
- Updating existing tests requires changing what they *assert* about
  join/leave semantics (beyond adding token fields) — that means behavior
  drifted somewhere unintended.
- You are tempted to log a token value anywhere. Log lengths or booleans
  only; the repo just had a log-sanitization pass (commit `821696a7e`).

## Maintenance notes

- Reviewer must verify the privacy property by reading `openSession`: the
  token rides only on the initial `Stream.fromArray` element, never on a
  `PubSub.publish`.
- Plan 006 (rate limiting) restructures the same `members` records to carry a
  token bucket — land this plan first so 006 builds on the `Member` type
  introduced here.
- Deferred: binding the token to the *WebSocket connection* (so a stolen
  token is useless from another socket). Worth revisiting if/when the RPC
  layer exposes a stable per-connection identity.
- Deferred: `OpenRoomSession` itself is still unauthenticated by design
  (room code = capability). If rooms ever get persistence or >2 members,
  revisit the whole model.
