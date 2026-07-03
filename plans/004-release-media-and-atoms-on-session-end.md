# Plan 004: Release the camera and clear stream atoms when a session ends

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 63fe051ba..HEAD -- packages/client-runtime/src/modules/room/PeerSession.ts packages/client-runtime/src/modules/room/PeerSession.test.ts apps/web/src/modules/room/peer-session/view.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Changes from plans 001–003 inside
> `PeerSession.ts` / `PeerSession.test.ts` are expected and fine.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (independent; trivially coexists with 001–003)
- **Category**: bug
- **Planned at**: commit `63fe051ba`, 2026-07-03

## Why this matters

Two user-visible bugs share one root cause — session-lifetime resources are
held by scopes/atoms that outlive the session's *useful* life:

1. **The camera light stays on behind the "Room is full" screen.**
   `startPeerSession` acquires mic + camera *before* the join outcome is
   known, and the media's release is tied to the whole session scope (owned by
   the UI atom). When the join is rejected (`RoomFull`, `PeerAlreadyJoined`)
   or the session dies (`SessionFailed`, `SignalingDisconnected`), only the
   actor fiber ends — the user stares at an error screen while their camera
   stays captured until they navigate away.
2. **Stale streams leak into the next call.** The web stream atoms are
   module-level `Atom.keepAlive` singletons. `peerRemoteStreamAtom` is nulled
   only on `PeerDeparted`/`TransportLost`; after a failed session, or when the
   user leaves and joins a *different* room, the atoms still hold dead
   `MediaStream` objects from the previous call, so the new room can briefly
   render a frozen previous remote frame.

After this plan: media is stopped the moment the session reaches any terminal
state, and every stream atom is cleared both on terminal states and at the
start of each new session.

## Current state

Relevant files:

- `packages/client-runtime/src/modules/room/PeerSession.ts` —
  `startPeerSession` acquires media and owns the terminal-exit handler.
- `apps/web/src/modules/room/peer-session/view.ts` — projects actor events
  into web atoms.
- `packages/client-runtime/src/modules/room/PeerSession.test.ts` — fixture
  records `acquireLocalMedia` / `releaseLocalMedia` operations.
- `apps/web/src/modules/room/peer-session/atoms.ts` — read-only context: the
  session is a scoped resource per `Atom.family` member; releasing the atom
  closes the session scope. That release path already works — don't change it.

`startPeerSession` today (`PeerSession.ts:687-778`, abridged):

```ts
export const startPeerSession = Effect.fn('@tether/client-runtime/startPeerSession')(function* (
  session: RoomSession,
) {
  const client = yield* AppClient;
  const platform = yield* PeerSessionPlatform;
  const peerSessionEventSink = yield* PeerSessionEventSink;
  ...
  // Local camera + microphone are acquired for the whole session (they outlive
  // any single peer connection) and released when the session scope closes.
  const localStream = yield* platform.acquireLocalMedia;
  yield* peerSessionEventSink.emit({ _tag: 'LocalStreamReady', stream: localStream });

  const actorLoop = Effect.gen(function* () { ... });

  yield* Effect.scoped(actorLoop).pipe(
    Effect.ensuring(Queue.shutdown(localInputQueue)),
    Effect.onExit(
      Effect.fnUntraced(function* (exit) {
        if (Exit.isSuccess(exit)) {
          yield* Effect.logInfo('Signaling stream ended');
          return yield* peerSessionEventSink.emit({ _tag: 'SignalingDisconnected' });
        }
        if (!Cause.hasInterruptsOnly(exit.cause)) {
          // ... maps RoomFull / PeerAlreadyJoined / PeerNotInRoom /
          // PlatformError / unknown to RoomJoinRejected | SignalingDisconnected
          // | SessionFailed events, each via `return yield* eventSink.emit(...)`
        }
      }),
    ),
    Effect.forkScoped({ startImmediately: true }),
  );
  ...
});
```

Note the actor (`makePeerSessionActor`) does `const actorScope = yield*
Scope.Scope;` and forks generation scopes via `Scope.fork(actorScope)`
(`PeerSession.ts:120`, `154-157`) — that is the repo's idiom for a closeable
child scope, reused below.

`view.ts` event projection today:

```ts
const emitPeerSessionEvent = (event: PeerSessionEvent) => {
  switch (event._tag) {
    case 'LocalStreamReady':
      return Atom.update(peerLocalStreamAtom, () => event.stream.value as MediaStream);
    case 'RemoteStreamReady':
      return Atom.update(peerRemoteStreamAtom, () => event.stream.value as MediaStream);
    case 'PeerDeparted':
    case 'TransportLost':
      return Atom.update(peerRemoteStreamAtom, () => null).pipe(
        Effect.andThen(
          Atom.update(peerSessionViewAtom, (view) => reducePeerSessionView(view, event)),
        ),
      );
    default:
      return Atom.update(peerSessionViewAtom, (view) => reducePeerSessionView(view, event));
  }
};
```

The terminal `PeerSessionEvent` tags (defined in `PeerSessionModel.ts`) are:
`SignalingDisconnected`, `SessionFailed`, `RoomJoinRejected`. `SessionStarted`
marks the beginning of every session.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install` (repo root) | exit 0 |
| Client-runtime tests | `cd packages/client-runtime && bun run test` | all pass |
| Lint (type-aware) | `bun run lint` (repo root) | exit 0 |
| Format check | `bun run fmt:check` (repo root) | exit 0 |
| Manual smoke | server + web dev servers (`bun run dev` in `apps/server` and `apps/web`) | see Step 4 |

## Scope

**In scope** (the only files you should modify):

- `packages/client-runtime/src/modules/room/PeerSession.ts`
- `packages/client-runtime/src/modules/room/PeerSession.test.ts`
- `apps/web/src/modules/room/peer-session/view.ts`

**Out of scope** (do NOT touch):

- `apps/web/src/modules/room/peer-session/atoms.ts` — the `keepAlive` choice
  is deliberate (see the comment in `view.ts`: early sink writes are lost
  without it). Do not remove `keepAlive`; clear values instead.
- `reducePeerSessionView` in `PeerSessionModel.ts` — streams are deliberately
  not part of the serializable view; keep the stream/atom handling in
  `view.ts`.
- `apps/web/src/modules/room/components/room.tsx` — no UI changes needed.

## Git workflow

- Branch: `advisor/004-release-media-on-session-end`
- Conventional commits, e.g.
  `fix(client-runtime): stop local media when the session reaches a terminal state`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Give local media its own closeable scope, closed on terminal exit

In `startPeerSession`:

1. Get the session scope and fork a media child scope (mirror the
   generation-scope idiom from `makePeerSessionActor`):

   ```ts
   const sessionScope = yield* Scope.Scope;
   const mediaScope = yield* Scope.fork(sessionScope);
   const localStream = yield* platform.acquireLocalMedia.pipe(Scope.provide(mediaScope));
   ```

2. In the `onExit` handler, close the media scope **before** emitting the
   terminal event, in every terminal path. To avoid adding a close call to
   each of the ~6 branches, close it once at the top of the handler:

   ```ts
   Effect.onExit(
     Effect.fnUntraced(function* (exit) {
       yield* Scope.close(mediaScope, Exit.void);
       ...existing branches unchanged...
     }),
   )
   ```

   Closing here is safe in all cases: on user-initiated teardown the parent
   scope was closing anyway (double-close of a child scope is a no-op), and on
   terminal failures this is exactly the new behavior we want.

**Verify**: `cd packages/client-runtime && bun run test` → all pass except
possibly tests asserting the exact position of `releaseLocalMedia` in the
fixture's `operations` array; if any fail, confirm the new ordering (release
now happens at terminal exit, before the terminal event emit) is precisely
what the test observes, and update the assertion. `bun run lint` → exit 0.

### Step 2: Clear the stream atoms on session start and terminal events

In `apps/web/src/modules/room/peer-session/view.ts`, extend
`emitPeerSessionEvent`:

```ts
case 'SessionStarted':
case 'SignalingDisconnected':
case 'SessionFailed':
case 'RoomJoinRejected':
  return Atom.update(peerLocalStreamAtom, () => null).pipe(
    Effect.andThen(Atom.update(peerRemoteStreamAtom, () => null)),
    Effect.andThen(
      Atom.update(peerSessionViewAtom, (view) => reducePeerSessionView(view, event)),
    ),
  );
```

Keep the existing `PeerDeparted`/`TransportLost` case (remote only — the
local stream is still live there) and the default case unchanged.

**Verify**: `bun run lint` → exit 0. `bun run fmt:check` → exit 0.

### Step 3: Regression test — media released on join rejection

In `PeerSession.test.ts`, following the existing `startPeerSession`-level
tests (the ones that run the full session against a fixture `AppClient` whose
`OpenRoomSession` returns a failing/ending stream):

1. **RoomFull releases media while the session scope is still open**: build a
   fixture whose `OpenRoomSession` fails with `RoomFull`. Run
   `startPeerSession` inside a scope you control; after the terminal event
   (`RoomJoinRejected` with reason `room-full`) is observed in `events`,
   assert `operations` contains `releaseLocalMedia` **without closing the
   outer scope**. (Today this assertion fails — release only happens on outer
   scope close.)
2. **Normal teardown still releases exactly once**: run a session, close the
   outer scope, assert `operations` contains exactly one `releaseLocalMedia`
   (guards against double-release from the child + parent scope closes).

**Verify**: `cd packages/client-runtime && bun run test` → all pass,
including the 2 new tests.

### Step 4: Manual smoke test

With server + web running: open a room in two tabs (call connects), then open
the same room in a **third** tab. The third tab shows "Room is full" — its
camera indicator (browser tab/OS light) must turn OFF within a second of the
error appearing. Then from the third tab navigate home and join a *new* room:
no frozen frame from any previous stream may flash before "Waiting for peer".

**Verify**: both observations hold.

## Test plan

Covered by Step 3 (2 new client-runtime tests, modeled on existing
`startPeerSession` tests in the same file). The atom-clearing in `view.ts` has
no unit-test harness in `apps/web` (no test script there); it is covered by
the Step 4 manual check — note this gap in your completion report.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd packages/client-runtime && bun run test` exits 0, including the 2
      new tests
- [ ] `bun run lint` and `bun run fmt:check` exit 0
- [ ] `grep -n "mediaScope" packages/client-runtime/src/modules/room/PeerSession.ts`
      shows the fork, the `Scope.provide`, and the close in `onExit`
- [ ] `grep -n "SessionStarted" apps/web/src/modules/room/peer-session/view.ts`
      shows the new atom-clearing case
- [ ] Manual smoke test (Step 4) passed
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `Scope.close` on the already-closing child scope is *not* a no-op in this
  Effect beta (symptom: test 2 in Step 3 sees a defect or double
  `releaseLocalMedia`). Check `repos/effect/packages/effect/src/Scope.ts`
  semantics; if genuinely unsafe, report — don't add ad-hoc "closed" flags.
- The `onExit` handler's shape differs materially from the excerpt (drift
  from plans 001/002 is fine; a *restructured* exit handler is not).
- Fixing the stale-stream flash seems to require touching `atoms.ts` or
  removing `keepAlive` — that changes documented behavior (see the comment at
  the top of `view.ts`) and needs a human decision.

## Maintenance notes

- Anyone adding a new *terminal* `PeerSessionEvent` tag must add it to both
  the `onExit` mapping in `PeerSession.ts` and the atom-clearing case in
  `view.ts` — reviewer should check the two lists stay in sync.
- Deferred: `apps/web` has no unit-test setup, so `view.ts` projection logic
  is only manually tested. If a web test harness lands later,
  `emitPeerSessionEvent` is the first thing to cover.
- Interaction with plan 002: reconnection emits `PeerInterrupted` (non-
  terminal) — media must NOT be released there; the terminal-only close in
  Step 1 already guarantees that.
