# Plan 006: Wire the TokenBucket into signaling and cap server resources

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 63fe051ba..HEAD -- apps/server/src/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Changes from plan 005 (the `Member`
> record with `sessionToken`) are expected — this plan assumes 005 has landed.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/005-session-token-identity.md (restructures the same
  `members` records)
- **Category**: security
- **Planned at**: commit `63fe051ba`, 2026-07-03

## Why this matters

The server currently accepts unbounded work from any client:

- `SendSignal` publishes to the room pubsub with no rate limit — a member can
  flood its peer with events.
- Rooms are created for *any* string `roomId`, each allocating an unbounded
  `PubSub`; one WebSocket can hold unlimited concurrent `OpenRoomSession`
  streams. Memory exhaustion is a `for` loop away.

Meanwhile `apps/server/src/lib/TokenBucket.ts` — a correct, fully tested
token bucket — sits **unwired and untracked in git** (see `git status`: both
`TokenBucket.ts` and `TokenBucket.test.ts` are `??`). A tested illusion of
safety. This plan commits it, attaches one bucket per room member to
rate-limit `SendSignal`, and adds a hard cap on concurrently live rooms.

## Current state

Relevant files:

- `apps/server/src/lib/TokenBucket.ts` — exists, UNTRACKED. Interface:

  ```ts
  export interface TokenBucket {
    readonly tryTake: Effect.Effect<boolean>;
  }
  export const makeTokenBucket = Effect.fnUntraced(function* (options: {
    readonly capacity: number;
    readonly refillEvery: Duration.Input;
  }) { ... });
  ```

  Continuous refill: one token per `refillEvery`, up to `capacity`. Dies on
  invalid config. Uses `Clock`, so tests control it with `TestClock`.
- `apps/server/src/lib/TokenBucket.test.ts` — exists, UNTRACKED, passing.
- `apps/server/src/modules/room/RoomService.ts` — after plan 005 the registry
  holds `members: Member[]` with `Member = { peerId, sessionToken }`.
  `openSession` creates rooms inside `SynchronizedRef.modifyEffect` (all
  registry mutations are serialized through this ref — new state must follow
  the same pattern). `sendSignal` verifies membership+token, then
  `PubSub.publish(ctx.pubsub, new SignalReceivedEvent({ peerId: selfId, signal }))`.
- `apps/server/src/modules/room/RoomService.test.ts` — service tests; uses
  `@effect/vitest` (`it.effect`) — check how existing cases are structured
  and whether a `TestClock` is already provided by the test layer.

Pre-tuning facts for the bucket parameters: during connection setup a peer
sends 1 offer/answer + typically 5–30 ICE candidates within a couple of
seconds, and reconnection (client plan 002) can repeat that burst. The limit
below (burst 50, sustained 5/s) is ~10× a legitimate worst case.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install` (repo root) | exit 0 |
| Server tests | `cd apps/server && bun run test` | all pass |
| Lint (type-aware) | `bun run lint` (repo root) | exit 0 |
| Format check | `bun run fmt:check` (repo root) | exit 0 |

## Scope

**In scope** (the only files you should modify):

- `apps/server/src/lib/TokenBucket.ts` (commit as-is; no code change expected)
- `apps/server/src/lib/TokenBucket.test.ts` (commit as-is)
- `apps/server/src/modules/room/RoomService.ts`
- `apps/server/src/modules/room/RoomService.test.ts`

**Out of scope** (do NOT touch):

- `apps/server/src/index.ts` — in particular `idleTimeout: 0`. It looks like
  a DoS problem, but Bun's idle timeout would also kill *healthy* quiet
  signaling sockets mid-call unless a heartbeat exists; changing it without a
  keepalive design breaks live calls. Leave it.
- `Handlers.ts`, contracts, client packages — rate limiting is invisible at
  the wire level by design (see Step 2).
- Per-connection / per-IP limiting — the RPC layer doesn't expose a stable
  connection identity to handlers; per-member limiting is the scoped goal.

## Git workflow

- Branch: `advisor/006-wire-token-bucket-rate-limiting`
- First commit: the two untracked TokenBucket files, e.g.
  `feat(server): add token bucket rate limiter` (they are new files — `git add`
  them explicitly).
- Then e.g. `feat(security): rate-limit signaling and cap live rooms`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Commit the TokenBucket

`git add apps/server/src/lib/TokenBucket.ts apps/server/src/lib/TokenBucket.test.ts`
and commit. No code changes.

**Verify**: `cd apps/server && bun run test` → all pass (its tests now run in
CI-land). `git status` → the two files no longer untracked.

### Step 2: Attach one bucket per member; drop over-limit signals

In `RoomService.ts`:

1. Constants at module level:

   ```ts
   const SIGNAL_BUCKET_CAPACITY = 50;
   const SIGNAL_BUCKET_REFILL_EVERY = Duration.millis(200);
   ```

2. Extend the member record: `Member` gains
   `readonly signalBucket: TokenBucket`. In `openSession`, inside the
   `modifyEffect` generator where the member is pushed:

   ```ts
   const signalBucket = yield* makeTokenBucket({
     capacity: SIGNAL_BUCKET_CAPACITY,
     refillEvery: SIGNAL_BUCKET_REFILL_EVERY,
   });
   ```

   and store it on the member.
3. In `sendSignal`, after the existing membership + token check resolves the
   member, gate the publish:

   ```ts
   const allowed = yield* member.signalBucket.tryTake;
   if (!allowed) {
     return yield* Effect.logWarning('Signal dropped by rate limit');
   }
   yield* PubSub.publish(ctx.pubsub, new SignalReceivedEvent({ peerId: selfId, signal }));
   ```

   **Drop, don't error**: failing the RPC would surface as a fatal
   `PeerNotInRoom`-class error on the legitimate client and kill its session;
   dropping degrades the flooder, not the victim. Do not add a new error type
   to the contracts.

**Verify**: `bun run lint` → exit 0. `cd apps/server && bun run test` →
existing tests pass (a fresh bucket allows the first 50 signals, far above
what any existing test sends).

### Step 3: Cap concurrently live rooms

In `RoomService.ts`:

1. Module constant: `const MAX_LIVE_ROOMS = 1000;`
2. In `openSession`, in the branch that creates a new room
   (`ctx === undefined`), before allocating the pubsub:

   ```ts
   if (newRegistry.size >= MAX_LIVE_ROOMS) {
     yield* Effect.logWarning('Room join rejected').pipe(
       Effect.annotateLogs('reason', 'server-at-capacity'),
     );
     return yield* new RoomFull({ roomId });
   }
   ```

   Reusing `RoomFull` is deliberate: it avoids a wire-schema change, the
   client already renders it ("This room already has two people" — slightly
   wrong copy under this condition, accepted), and empty rooms are already
   deleted on last leave (`RoomService.ts` leave path), so the cap only bites
   under genuine load or attack. Joining an *existing* room is not affected
   by the cap.

**Verify**: `cd apps/server && bun run test` → all pass.

### Step 4: Tests

In `RoomService.test.ts`, modeled on its existing cases:

1. **Flood is limited**: A and B join. As A, send
   `SIGNAL_BUCKET_CAPACITY + 10` signals in a tight loop (no clock
   advancement). Assert B's subscription received exactly
   `SIGNAL_BUCKET_CAPACITY` `SignalReceivedEvent`s, and that every `sendSignal`
   call *succeeded* (drops are silent).
2. **Bucket refills**: after exhausting the bucket, advance the `TestClock`
   by 1 second, send 5 more signals, assert exactly 5 arrive.
3. **Buckets are per-member**: exhaust A's bucket; a signal from B still
   arrives at A.
4. **Room cap**: this needs `MAX_LIVE_ROOMS` exported or the test creating
   1000 rooms. Export the constant (and `SIGNAL_BUCKET_CAPACITY`) from
   `RoomService.ts` for the tests, then create `MAX_LIVE_ROOMS` rooms in a
   loop (one member each) and assert the next *new* room fails with
   `RoomFull` while joining an existing room still succeeds. If creating 1000
   rooms makes the test slow (>2s), lower nothing in prod code — instead note
   it and set the loop to create rooms until failure, asserting failure
   happens at exactly `MAX_LIVE_ROOMS`.

## Test plan

Covered by Step 4 (4 new tests). Exemplar: existing `RoomService.test.ts`
cases that open two sessions and assert on received events. `TokenBucket`'s
own unit tests already cover refill math — don't duplicate them; the new
tests cover the *wiring*.

Verification: `cd apps/server && bun run test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `git ls-files apps/server/src/lib/TokenBucket.ts` returns the path
      (file is tracked)
- [ ] `cd apps/server && bun run test` exits 0, including the 4 new tests
- [ ] `bun run lint` and `bun run fmt:check` exit 0
- [ ] `grep -n "signalBucket" apps/server/src/modules/room/RoomService.ts`
      shows creation in `openSession` and the gate in `sendSignal`
- [ ] `grep -n "MAX_LIVE_ROOMS" apps/server/src/modules/room/RoomService.ts`
      shows the cap enforced in the room-creation branch
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 005 has not landed (members are still a bare `PeerId[]`).
- `makeTokenBucket` cannot run inside the `SynchronizedRef.modifyEffect`
  generator (it needs only `Clock` + `Ref`; if the effect context objects,
  report the type error rather than moving bucket creation outside the
  serialized mutation).
- Existing tests fail after Step 2 because they legitimately send >50 signals
  — re-read the test; if the *test* models a real client pattern exceeding
  the budget, the constants need a human decision, not a silent bump.
- You find yourself wanting to change `idleTimeout` or add heartbeats —
  explicitly out of scope.

## Maintenance notes

- The constants (50 / 200ms / 1000 rooms) are first-guess budgets ~10× a
  legitimate worst case. If plan 002 (client reconnection) lands later and
  reconnect storms hit the limit, raise `SIGNAL_BUCKET_CAPACITY` before
  touching the refill rate.
- Known residual gaps, deliberately unaddressed here: per-IP limiting (needs
  connection identity at the RPC layer), `OpenRoomSession` call-rate limiting
  (each call is already bounded by the room cap and two-member rule), and
  socket idle timeout (needs a heartbeat design first).
- Reviewer should scrutinize: the drop path logs at `warning` and returns
  success — confirm no code path converts a drop into an RPC error.
