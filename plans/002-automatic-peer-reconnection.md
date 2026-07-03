# Plan 002: Recover failed peer connections automatically instead of dead-ending

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 63fe051ba..HEAD -- packages/client-runtime/src/modules/room/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Exception: changes introduced by
> `plans/001-non-fatal-signal-errors.md` are expected — this plan assumes 001
> has landed (a `remoteAnswerApplied` field on `PeerKnown`, and a
> platform-`overrides` parameter on the test fixture's `makeFixture`).

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-non-fatal-signal-errors.md
- **Category**: bug
- **Planned at**: commit `63fe051ba`, 2026-07-03

## Why this matters

Tether's peer-session state machine diagnoses failures but never recovers from
them. Today:

- A failed peer connection (`PeerConnectionFailed` while `PeerKnown`) moves
  the actor to `TransportLost`, and the **only** exit from `TransportLost` is
  the *other* peer fully leaving the room (`PeerLeftEvent`). If both peers hit
  a transient network blip, both sit in `TransportLost` forever, each waiting
  for a `PeerLeft` that never comes, until a human hangs up.
- A negotiation that stalls for 20s emits `NegotiationStalled` and does
  nothing else; the UI's advice is literally "You can leave and retry."
- A closed data channel is treated as `TransportLost` immediately.

For a calling app, reconnection is the product. After this plan lands, the
actor responds to connection failure, data-channel closure, and negotiation
stall by tearing down only the failed connection *generation* and renegotiating
a fresh one with the same peer — up to 2 attempts — before falling back to
today's terminal states. Signaling (the room WebSocket) stays up throughout,
so no server changes are needed.

## Current state

Relevant files:

- `packages/client-runtime/src/modules/room/PeerSession.ts` — the actor; all
  logic changes happen here.
- `packages/client-runtime/src/modules/room/PeerSession.test.ts` — actor tests
  with a fake platform; new tests go here.
- `packages/client-runtime/src/modules/room/PeerSessionModel.ts` — event
  types (`PeerSessionEvent` includes `PeerInterrupted`, which the view reducer
  maps to a `reconnecting` status). Read-only.
- `apps/web/src/modules/room/components/room.tsx` — already renders a
  `reconnecting` status ("Connection interrupted — trying to recover…").
  Read-only; no UI change needed.

Key existing machinery you will reuse (do not reinvent):

- **Generations**: each peer connection lives in a child scope
  (`acquirePeerConnectionGeneration`, `PeerSession.ts:154-168`). Closing the
  scope closes the connection and detaches its listeners; queued events from a
  closed generation are rejected by handle-identity checks.
- **Deadline timer**: `armNegotiationDeadline` (`PeerSession.ts:177-189`)
  forks a one-shot 20s timer into the generation scope; it dispatches
  `NegotiationDeadlineElapsed` carrying the connection handle.
- **Roles are stable**: the offerer/answerer role is assigned once per pairing
  and both sides keep it. The answerer accepts *any* offer while in role
  `answerer` (`handleSignal`, `PeerSession.ts:252-257`) — this is what makes
  offerer-initiated renegotiation work without protocol changes.

The three handlers this plan rewires, as they exist today:

`handlePeerConnectionFailed` (`PeerSession.ts:359-392`) — on failure while
`PeerKnown`: closes the generation, sets `TransportLost`, emits
`TransportLost`. While `WaitingForPeer`: closes and re-acquires a generation
(keep that branch as is).

`handleDataChannelClosed` (`PeerSession.ts:394-413`) — closes the generation,
sets `TransportLost`, emits `TransportLost`.

`handleNegotiationDeadlineElapsed` (`PeerSession.ts:488-501`) — if the same
generation is still mid-negotiation, emits `NegotiationStalled` and changes no
state.

The offerer's initial connect flow in `handleRoomSessionOpened`
(`PeerSession.ts:196-222`) is the template for what a reconnect attempt must
do on the offerer side:

```ts
const generation = yield* acquirePeerConnectionGeneration();
// ...
const dataChannel = yield* platform.createDataChannel(
  generation.peerConnection,
  CHAT_CHANNEL_LABEL,
);
yield* platform
  .observeDataChannel(dataChannel, dispatchLocalInput)
  .pipe(Scope.provide(generation.scope));
yield* armNegotiationDeadline(generation);
yield* createAndSendOffer(generation.peerConnection);
state = { _tag: 'PeerKnown', generation, peerId, role: 'offerer',
  dataChannelState: { _tag: 'DataChannelConnecting', dataChannel },
  remoteAnswerApplied: false };
```

Design note — why fresh-generation renegotiation, not `RTCPeerConnection.restartIce()`:
an ICE restart on the same connection only helps when the SCTP association
(and thus the data channel) survived. When the data channel has closed, the
old connection is unrecoverable anyway. Replacing the generation handles both
cases with one mechanism the codebase already has, at the cost of a slightly
slower recovery. Do not add `restartIce` to the platform interface.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install` (repo root) | exit 0 |
| Unit tests | `cd packages/client-runtime && bun run test` | all pass |
| Lint (type-aware) | `bun run lint` (repo root) | exit 0 |
| Format check | `bun run fmt:check` (repo root) | exit 0 |

## Scope

**In scope** (the only files you should modify):

- `packages/client-runtime/src/modules/room/PeerSession.ts`
- `packages/client-runtime/src/modules/room/PeerSession.test.ts`

**Out of scope** (do NOT touch, even though they look related):

- `PeerSessionServices.ts` / the platform interface — no new operations.
- `apps/web/src/modules/room/**` — the `reconnecting` UI status already
  exists; no web changes.
- Server code — signaling is unchanged.
- `TransportLost` recovery via `PeerLeft` (`handlePeerLeft`) — keep it; it is
  the fallback when reconnection attempts are exhausted.
- The 20-second `NEGOTIATION_DEADLINE` constant — do not tune it here.

## Git workflow

- Branch: `advisor/002-automatic-peer-reconnection`
- Conventional commits, e.g.
  `feat(client-runtime): renegotiate a fresh connection generation on transport failure`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Track reconnect attempts in `PeerKnown`

Add `readonly reconnectAttempts: number` to the `PeerKnown` state variant.
Initialize to `0` at both initial constructions (`handleRoomSessionOpened`
offerer path, `handlePeerJoined` answerer path). Add a module constant:

```ts
const MAX_RECONNECT_ATTEMPTS = 2;
```

Reset to `0` in `handleDataChannelOpened` when transitioning to
`DataChannelOpen` (a successful reconnect must refill the budget):
`state = { ...state, dataChannelState: ..., reconnectAttempts: 0 };`

**Verify**: `bun run lint` → exit 0 (the type forces every construction site
to be updated). `cd packages/client-runtime && bun run test` → all pass.

### Step 2: Extract a `beginPeerReconnect` helper

Add a handler-style helper inside `makePeerSessionActor`:

```ts
const beginPeerReconnect = Effect.fnUntraced(function* () {
  if (state._tag !== 'PeerKnown') return;

  const { peerId, role, reconnectAttempts } = state;
  yield* Scope.close(state.generation.scope, Exit.void);

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    state = { _tag: 'TransportLost', peerId };
    yield* Effect.logWarning('Reconnect attempts exhausted');
    return yield* eventSink.emit({ _tag: 'TransportLost', peerId });
  }

  const generation = yield* acquirePeerConnectionGeneration();
  yield* eventSink.emit({ _tag: 'PeerInterrupted', peerId });

  if (role === 'answerer') {
    state = { _tag: 'PeerKnown', generation, peerId, role,
      dataChannelState: { _tag: 'AwaitingRemoteDataChannel' },
      remoteAnswerApplied: false, reconnectAttempts: reconnectAttempts + 1 };
    yield* armNegotiationDeadline(generation);
    return;
  }

  const dataChannel = yield* platform.createDataChannel(
    generation.peerConnection, CHAT_CHANNEL_LABEL);
  yield* platform.observeDataChannel(dataChannel, dispatchLocalInput)
    .pipe(Scope.provide(generation.scope));
  yield* armNegotiationDeadline(generation);
  yield* createAndSendOffer(generation.peerConnection);
  state = { _tag: 'PeerKnown', generation, peerId, role,
    dataChannelState: { _tag: 'DataChannelConnecting', dataChannel },
    remoteAnswerApplied: false, reconnectAttempts: reconnectAttempts + 1 };
});
```

Place it after `armNegotiationDeadline` so everything it calls is already
defined. Note `remoteAnswerApplied: false` — the reconnect offer expects a
fresh answer (this is the interplay flagged in plan 001).

**Verify**: `bun run lint` → exit 0.

### Step 3: Route the three failure handlers into it

1. `handlePeerConnectionFailed`, `PeerKnown` branch: replace the body
   (close-scope / set-`TransportLost` / emit) with
   `yield* Effect.logWarning('Peer connection failed'); return yield* beginPeerReconnect();`
   Leave the `WaitingForPeer` branch and the identity guards untouched.
2. `handleDataChannelClosed`: after the existing guards, replace the
   close/`TransportLost`/emit body with the same log-then-
   `beginPeerReconnect()` call (log message: `'Data channel closed'`).
3. `handleNegotiationDeadlineElapsed`: after the existing guards (same
   generation, channel not open), replace the emit-only body with:
   if `state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS`, keep today's
   behavior (`logWarning('Negotiation stalled')` + emit `NegotiationStalled`);
   otherwise `yield* beginPeerReconnect();`.

**Verify**: `cd packages/client-runtime && bun run test`. Expect failures
**only** in existing tests that assert the old semantics (immediate
`TransportLost` on first failure / stall-only deadline). Update those tests to
the new semantics: first failure → `PeerInterrupted` emitted, state remains
`PeerKnown`, a new offer is sent (offerer) or a new generation awaited
(answerer). If a test failure is *not* clearly one of these, treat it as a
STOP condition.

### Step 4: Regression tests for the new behavior

Add to `PeerSession.test.ts`, modeled on existing cases (feed inputs to the
handler, assert on `operations`, `signals`, `events`):

1. **Offerer reconnects after connection failure**: drive to
   `PeerKnown`/offerer with the channel open, dispatch
   `PeerConnectionFailed` for the current handle. Assert: old generation
   closed (`closePeerConnection` in `operations`), a second
   `acquirePeerConnection` + `createDataChannel:chat` + a second offer in
   `signals`, `PeerInterrupted` in `events`, and **no** `TransportLost`.
2. **Answerer waits after connection failure**: same but role answerer
   (drive via `WaitingForPeer` → `PeerJoined`). Assert new generation
   acquired, **no** `createDataChannel` for the new generation, no offer sent,
   `PeerInterrupted` emitted.
3. **Attempts exhausted → TransportLost**: dispatch `PeerConnectionFailed`
   three times (re-fetch the current generation's handle each time — the
   fixture's `makePeerConnection` hands out fresh handles). Assert exactly 2
   `PeerInterrupted` events, then one `TransportLost`.
4. **Successful reconnect refills the budget**: after one failure and
   reconnect, deliver `DataChannelOpened` for the new channel, then fail
   again; assert it reconnects (emits `PeerInterrupted`, not `TransportLost`).
5. **Reconnect answer accepted**: after an offerer reconnect, deliver an
   answer signal; assert `setRemoteDescription:answer:...` happens for the
   new generation (guards from plan 001 must not block it).
6. **Deadline triggers reconnect**: drive to `PeerKnown` mid-negotiation, use
   `TestClock` to advance past 20s (existing deadline tests show the pattern),
   assert a reconnect (new offer) rather than `NegotiationStalled`; exhaust
   attempts and assert `NegotiationStalled` on the final deadline.

Note for tests 1–6: after a reconnect the current data channel is a *new*
handle. The fixture's `createDataChannel` returns the same `localDataChannel`
object every call — if handle identity checks make a test impossible, extend
the fixture to mint distinct channel handles per call (allowed within the test
file).

## Test plan

Covered by Steps 3–4: updated legacy assertions plus 6 new cases.
Verification: `cd packages/client-runtime && bun run test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd packages/client-runtime && bun run test` exits 0, including the 6
      new tests
- [ ] `bun run lint` and `bun run fmt:check` (root) exit 0
- [ ] `grep -c "beginPeerReconnect" packages/client-runtime/src/modules/room/PeerSession.ts`
      ≥ 4 (definition + three call sites)
- [ ] `grep -n "MAX_RECONNECT_ATTEMPTS" packages/client-runtime/src/modules/room/PeerSession.ts`
      shows the constant set to 2
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 001 has not landed (no `remoteAnswerApplied` field on `PeerKnown`).
- The excerpted handler bodies don't match the live code (drift).
- An existing test fails after Step 3 for a reason *other than* asserting the
  old immediate-`TransportLost` / stall-only semantics.
- You find `beginPeerReconnect` needs to touch `startPeerSession` or the
  platform interface to work — the design above should not require either.
- Both-sides race handling seems to require server changes. (Known
  limitation, accepted: if the answerer applies a reconnect offer to its old,
  already-failed connection just before its own failure event arrives, that
  attempt is wasted and the *next* deadline-driven attempt recovers. Do not
  fix this here.)

## Maintenance notes

- The accepted race above means worst-case recovery is one deadline period
  (20s) slower than ideal. If field reports show frequent double-attempts,
  the follow-up is an explicit "reconnect epoch" carried in the offer SDP or
  a signaling-level marker — a design task, not a patch.
- Reviewer should scrutinize: every `state = { _tag: 'PeerKnown', ... }`
  construction site now sets both `remoteAnswerApplied` and
  `reconnectAttempts`; and that `handlePeerLeft`'s `TransportLost` branch
  still works (it remains the recovery of last resort).
- Plan 003 (TURN) sharply reduces how often this code path runs; they are
  independent but complementary.
