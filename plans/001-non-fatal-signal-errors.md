# Plan 001: Make per-signal failures non-fatal to the peer session

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 63fe051ba..HEAD -- packages/client-runtime/src/modules/room/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `63fe051ba`, 2026-07-03

## Why this matters

Tether is a 1:1 WebRTC calling app. The client-side peer-session actor
(`packages/client-runtime/src/modules/room/PeerSession.ts`) treats **every**
platform error as fatal: any failed WebRTC operation propagates out of the
actor's input loop, which maps it to a `SessionFailed` UI state and tears down
the whole call — media, chat, everything.

Two of those failures are *normal* WebRTC events, not session-level breakage:

1. `RTCPeerConnection.addIceCandidate` rejecting. Malformed or out-of-order
   candidates happen in the wild; the universal practice (see the W3C
   "perfect negotiation" pattern) is to log and drop them.
2. A **duplicate answer**. Calling `setRemoteDescription(answer)` when the
   connection is already in `stable` state throws `InvalidStateError`.

Today a buggy — or hostile — remote peer can end your call by sending one bad
ICE candidate string or a second answer. After this plan lands, those inputs
are logged and ignored, and only genuinely session-level failures reach
`SessionFailed`.

## Current state

Relevant files:

- `packages/client-runtime/src/modules/room/PeerSession.ts` — the peer-session
  actor. All changes happen here.
- `packages/client-runtime/src/modules/room/PeerSession.test.ts` — drives the
  actor's input handler directly with a fake platform. New tests go here.
- `packages/client-runtime/src/modules/room/PeerSessionModel.ts` — defines
  `PlatformError` (a `Data.TaggedError('PlatformError')` with an `operation`
  field). Read-only for this plan.

The actor keeps one mutable `state` value. The `PeerKnown` variant
(`PeerSession.ts:51-57`) currently looks like:

```ts
| {
    readonly _tag: 'PeerKnown';
    readonly generation: PeerConnectionGeneration;
    readonly peerId: PeerId;
    readonly role: PeerRole;
    readonly dataChannelState: DataChannelState;
  }
```

`handleSignal` (`PeerSession.ts:242-272`) processes signals from the remote
peer. The two problem sites:

```ts
// Offerer receiving an answer — no guard against a second answer:
if (state.role !== 'offerer') {
  return yield* Effect.logWarning('Ignored answer received in invalid role');
}
yield* platform.setRemoteDescription(state.generation.peerConnection, {
  type: 'answer',
  sdp: signal.sdp,
});
return;
```

```ts
// ICE candidate — an addIceCandidate failure escapes and kills the session:
case '@tether/IceCandidateSignal':
  return yield* platform.addIceCandidate(state.generation.peerConnection, signal);
```

Errors escaping any handler propagate through `Stream.runForEach` in
`startPeerSession` (`PeerSession.ts:716-778`), whose `onExit` handler maps
`isPlatformError(error)` to `eventSink.emit({ _tag: 'SessionFailed' })`. That
fatal path is **correct** for real failures (e.g. `createOffer` failing) and
must not change.

Repo conventions to match:

- Handlers are `Effect.fnUntraced(function* (...) { ... })` generator
  functions; state transitions assign a whole new object to `state`.
- Ignored inputs are logged with `Effect.logWarning('Ignored ...')` — see
  `PeerSession.ts:254` for the pattern.
- Comments are minimal and terse; only add one where the code can't say it.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install` (repo root) | exit 0 |
| Unit tests | `cd packages/client-runtime && bun run test` | all pass |
| Lint (type-aware) | `bun run lint` (repo root) | exit 0 |
| Format check | `bun run fmt:check` (repo root) | exit 0 (`bun run fmt` to fix) |

## Scope

**In scope** (the only files you should modify):

- `packages/client-runtime/src/modules/room/PeerSession.ts`
- `packages/client-runtime/src/modules/room/PeerSession.test.ts`

**Out of scope** (do NOT touch, even though they look related):

- `startPeerSession`'s `onExit` error mapping (`PeerSession.ts:724-778`) —
  the fatal path for real platform errors stays exactly as is.
- `apps/web/src/modules/room/peer-session/platform.ts` — the browser adapter
  is correct; failures must be handled in the actor, not hidden in the adapter.
- The answerer's offer path (`acceptOfferAndSendAnswer`) — repeated offers are
  legitimate renegotiation and plan 002 relies on them staying accepted.
- Anything under `repos/` (vendored read-only reference).

## Git workflow

- Branch: `advisor/001-non-fatal-signal-errors`
- Conventional commits, matching `git log` style, e.g.
  `fix(client-runtime): drop failed ICE candidates instead of failing the session`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Drop ICE-candidate application failures

In `handleSignal`, wrap the `addIceCandidate` call so a `PlatformError` is
logged and swallowed:

```ts
case '@tether/IceCandidateSignal':
  return yield* platform.addIceCandidate(state.generation.peerConnection, signal).pipe(
    Effect.catchTag('PlatformError', (error) =>
      Effect.logWarning('Dropped ICE candidate that failed to apply').pipe(
        Effect.annotateLogs('operation', error.operation),
      ),
    ),
  );
```

**Verify**: `cd packages/client-runtime && bun run test` → all existing tests
still pass.

### Step 2: Guard against duplicate answers

1. Add a `remoteAnswerApplied: boolean` field to the `PeerKnown` state variant.
2. Set it to `false` at both places a `PeerKnown` state is first constructed:
   the offerer path in `handleRoomSessionOpened` (`PeerSession.ts:216-222`) and
   the answerer path in `handlePeerJoined` (`PeerSession.ts:232-238`).
3. In `handleSignal`'s answer branch (offerer role): if
   `state.remoteAnswerApplied` is already `true`, log
   `Effect.logWarning('Ignored duplicate answer')` and return without touching
   the platform. Otherwise apply the remote description as today, then
   transition: `state = { ...state, remoteAnswerApplied: true };`.

Do **not** reset the flag anywhere else in this plan. (Plan 002 will reset it
when it introduces reconnection offers — note this in your commit message.)

**Verify**: `cd packages/client-runtime && bun run test` → all pass.
`bun run lint` → exit 0 (this also catches any missed `remoteAnswerApplied`
initialization, since the state type now requires it).

### Step 3: Add a platform-override hook to the test fixture

`PeerSession.test.ts` builds its fake platform inside `makeFixture`
(`PeerSession.test.ts:51-138`) with hardcoded success behavior. To test
failures, extend `makeFixture` with an optional third parameter:

```ts
overrides?: Partial<PeerSessionPlatform['Service']>
```

and construct the platform as
`PeerSessionPlatform.of({ ...basePlatform, ...overrides })` (build the current
object literal into a `basePlatform` variable first). All existing callers pass
no overrides and must keep working unchanged.

**Verify**: `cd packages/client-runtime && bun run test` → all pass (no
behavior change yet).

### Step 4: Write the regression tests

In `PeerSession.test.ts`, following the structure of the existing tests in the
same file (drive the handler from `makePeerSessionActor`, inspect the
fixture's `operations`, `signals`, and `events` arrays):

1. **Failed ICE candidate is dropped, session survives**: override
   `addIceCandidate` to `Effect.fail(new PlatformError({ operation: 'add-ice-candidate', cause: 'boom' }))`.
   Drive the actor to `PeerKnown`, deliver an ICE signal, assert the handler
   effect **succeeds** (no error), then deliver a subsequent valid input (e.g.
   another signal) and assert it is still processed. Assert no `SessionFailed`
   event was emitted.
2. **Duplicate answer is ignored**: drive the offerer path
   (`RoomSessionOpenedEvent` with an existing `peerId`), deliver an answer
   signal twice. Assert `operations` contains exactly one
   `setRemoteDescription:answer:...` entry and the handler did not fail.

## Test plan

Covered by Step 4. Pattern to model after: any existing `it.effect` case in
`PeerSession.test.ts` that constructs the fixture, feeds
`RoomSessionOpenedEvent`/`SignalReceivedEvent` inputs to the handler, and
asserts on `operations`/`events`.

Verification: `cd packages/client-runtime && bun run test` → all pass,
including the 2 new tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd packages/client-runtime && bun run test` exits 0; the two new tests
      from Step 4 exist and pass
- [ ] `bun run lint` (root) exits 0
- [ ] `bun run fmt:check` (root) exits 0
- [ ] `grep -n "remoteAnswerApplied" packages/client-runtime/src/modules/room/PeerSession.ts`
      shows the field in the `PeerKnown` type, both constructions, and the
      guard in `handleSignal`
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the cited lines doesn't match the excerpts above (drift).
- `Effect.catchTag('PlatformError', ...)` does not typecheck against this
  Effect version (the repo pins `effect@^4.0.0-beta.93`; check
  `repos/effect/` for the current `catchTag` signature before working around
  it — do not switch to `catchAll`, which would also swallow defects).
- Making the fixture-override change (Step 3) requires modifying more than
  `makeFixture` and its call sites within the test file.
- Any *existing* test starts failing after Step 1 or 2 — that means a test
  encodes the current fatal behavior, and the intended semantics need a human
  decision.

## Maintenance notes

- Plan 002 (peer reconnection) builds directly on this: it resets
  `remoteAnswerApplied` when sending a reconnection offer, and reuses the
  Step 3 fixture-override hook for failure-injection tests. Land this first.
- Reviewer should scrutinize: that only the ICE-candidate branch got
  `catchTag` — `setRemoteDescription` for the *first* answer, `createOffer`,
  `createAnswer` must remain fatal.
- Deliberately deferred: making a failed `acceptOfferAndSendAnswer`
  non-fatal. That failure means negotiation is genuinely broken and plan 002's
  retry loop is the right recovery, not a silent drop.
