# Plan 003: Serve ICE server config from the server and support TURN

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 63fe051ba..HEAD -- packages/contracts/src/modules/room/ apps/server/src/ packages/client-runtime/src/modules/room/ apps/web/src/modules/room/peer-session/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Changes from plans 001/002 inside
> `PeerSession.ts` / `PeerSession.test.ts` are expected and fine.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (independent of 001/002; merge order with them is
  irrelevant apart from routine conflicts in `PeerSession.ts`)
- **Category**: bug
- **Planned at**: commit `63fe051ba`, 2026-07-03

## Why this matters

The web client hardcodes a single Google STUN server
(`apps/web/src/modules/room/peer-session/platform.ts:36`). STUN-only WebRTC
cannot connect two peers when either is behind symmetric NAT or CGNAT — which
is most mobile carriers and many corporate networks. Those users sit at
"Taking longer than expected" forever, and localhost e2e tests can never catch
it because localhost always connects.

After this plan lands, the server owns ICE configuration: clients fetch the
ICE server list over the existing RPC channel at session start, the operator
configures a TURN server (plus credentials) via environment variables, and
the Google STUN default is just a fallback. This is also the prerequisite for
ephemeral TURN credentials later — the client no longer bakes in any ICE
config.

## Current state

Relevant files:

- `packages/contracts/src/modules/room/Schemas.ts` — schema classes/structs
  for the room module. New `IceServer` schema and RPC payload types go here.
- `packages/contracts/src/modules/room/Rpcs.ts` — defines `RoomRpcs =
  RpcGroup.make(OpenRoomSessionRpc, SendSignalRpc, LeaveRoomRpc)`. The new
  `GetIceServers` RPC goes here.
- `packages/contracts/src/modules/room/index.ts` — the module barrel; export
  anything new from here (repo convention: feature code is imported from
  `@tether/contracts/modules/room`, never the package root).
- `apps/server/src/modules/room/Handlers.ts` — implements the RPC group:

  ```ts
  export const RoomHandlers = RoomRpcs.toLayer(
    Effect.gen(function* () {
      const room = yield* RoomService;
      return RoomRpcs.of({
        OpenRoomSession: ...,
        LeaveRoom: ...,
        SendSignal: ...,
      });
    }),
  );
  ```

- `apps/server/src/App.ts` — shows the repo's `Config` idiom:

  ```ts
  const origins = yield* Config.string('CORS_ORIGIN').pipe(
    Config.withDefault('http://localhost:5173'),
  );
  ```

- `packages/client-runtime/src/modules/room/PeerSessionServices.ts` — the
  platform interface. Current signature to change:

  ```ts
  readonly acquirePeerConnection: Effect.Effect<PeerConnectionHandle, PlatformError, Scope.Scope>;
  ```

- `packages/client-runtime/src/modules/room/PeerSession.ts` — the actor.
  `acquirePeerConnectionGeneration` (`PeerSession.ts:154-168`) calls
  `platform.acquirePeerConnection`; `startPeerSession` (`PeerSession.ts:687`)
  has `const client = yield* AppClient` and forks the actor loop.
- `apps/web/src/modules/room/peer-session/platform.ts` — browser adapter with
  the hardcoded config:

  ```ts
  const acquirePeerConnection = Effect.acquireRelease(
    Effect.try({
      try: () => ({
        value: new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        }),
      }),
      ...
  ```

- Tests that must be extended: `apps/server/src/modules/room/Handlers.test.ts`
  and `packages/client-runtime/src/modules/room/PeerSession.test.ts` (fake
  platform in `makeFixture`).

Repo conventions: schemas are `Schema.TaggedClass` / `Schema.Struct` in
`Schemas.ts`; RPCs are `Rpc.make(name, { payload, success, error })`; server
config uses `Config.string(...).pipe(Config.withDefault(...))`; everything
under `repos/effect/` is the API reference of record for this Effect beta.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install` (repo root) | exit 0 |
| Server tests | `cd apps/server && bun run test` | all pass |
| Client-runtime tests | `cd packages/client-runtime && bun run test` | all pass |
| All tests | `bun run test` (root, turbo) | all pass |
| Lint (type-aware) | `bun run lint` (repo root) | exit 0 |
| Format check | `bun run fmt:check` (repo root) | exit 0 |
| Manual smoke | `cd apps/server && bun run dev` then `cd apps/web && bun run dev`, open two tabs on the printed URL, join the same room | call connects |

## Scope

**In scope** (the only files you should modify):

- `packages/contracts/src/modules/room/Schemas.ts`
- `packages/contracts/src/modules/room/Rpcs.ts`
- `packages/contracts/src/modules/room/index.ts` (exports only)
- `apps/server/src/modules/room/Handlers.ts`
- `apps/server/src/modules/room/Handlers.test.ts`
- `packages/client-runtime/src/modules/room/PeerSessionServices.ts`
- `packages/client-runtime/src/modules/room/PeerSession.ts`
- `packages/client-runtime/src/modules/room/PeerSession.test.ts`
- `apps/web/src/modules/room/peer-session/platform.ts`

**Out of scope** (do NOT touch):

- Deploying/operating an actual TURN server (coturn) — this plan only makes
  the app *configurable*; a local coturn recipe goes in the maintenance notes,
  not in code.
- Ephemeral/HMAC TURN credentials — follow-up; static env credentials only.
- `apps/mobile/**` — stub app, no WebRTC yet.
- `RoomService.ts` — ICE config is stateless; it does not belong in the room
  registry service.

## Git workflow

- Branch: `advisor/003-turn-server-support`
- Conventional commits, e.g. `feat(contracts): add GetIceServers rpc` /
  `feat(server): serve ice config from env` /
  `feat(client-runtime): fetch ice servers at session start`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Contracts — `IceServer` schema and `GetIceServers` RPC

In `Schemas.ts` add:

```ts
export const IceServer = Schema.Struct({
  urls: Schema.Array(Schema.String),
  username: Schema.optional(Schema.String),
  credential: Schema.optional(Schema.String),
});
export type IceServer = typeof IceServer.Type;

export const GetIceServersSuccess = Schema.Struct({
  iceServers: Schema.Array(IceServer),
});
```

(Check `Schema.optional`'s exact spelling against another optional-field usage
in `repos/effect/packages/effect/src/Schema.ts` or existing app code before
committing.) In `Rpcs.ts` add and register:

```ts
const GetIceServersRpc = Rpc.make('GetIceServers', {
  success: GetIceServersSuccess,
});

export const RoomRpcs = RpcGroup.make(
  OpenRoomSessionRpc, SendSignalRpc, LeaveRoomRpc, GetIceServersRpc,
);
```

Export `IceServer` (and the success struct) from the module barrel
`index.ts`, matching how existing schemas are exported.

**Verify**: `bun run lint` → will FAIL at this point only in
`apps/server/src/modules/room/Handlers.ts` complaining the RPC group is not
fully handled — that confirms the RPC is registered. Proceed.

### Step 2: Server — serve the config from env

In `Handlers.ts`, inside the existing `Effect.gen`, read config (top of the
generator, next to `const room = yield* RoomService`):

```ts
const stunUrls = yield* Config.string('STUN_URLS').pipe(
  Config.withDefault('stun:stun.l.google.com:19302'),
);
const turnUrl = yield* Config.string('TURN_URL').pipe(Config.withDefault(''));
const turnUsername = yield* Config.string('TURN_USERNAME').pipe(Config.withDefault(''));
const turnCredential = yield* Config.string('TURN_CREDENTIAL').pipe(Config.withDefault(''));

const iceServers = [
  { urls: stunUrls.split(',').map((url) => url.trim()) },
  ...(turnUrl !== ''
    ? [{ urls: [turnUrl], username: turnUsername, credential: turnCredential }]
    : []),
];
```

Add the handler:

```ts
GetIceServers: () => Effect.succeed({ iceServers }),
```

(If the handler signature requires an `Effect.fnUntraced` generator like its
siblings, match them.) Import `Config` from `'effect'`.

**Verify**: `bun run lint` → exit 0. `cd apps/server && bun run test` → all
pass.

### Step 3: Server handler test

In `Handlers.test.ts`, following the existing test structure (they build the
handlers layer and call RPCs through it):

1. Default: with no env set, `GetIceServers` returns exactly one entry whose
   `urls` is `['stun:stun.l.google.com:19302']`.
2. TURN configured: provide config values (`ConfigProvider.fromJson` /
   `fromMap` — check `repos/effect/packages/effect` for the current API, and
   how the existing tests provide layers) so `TURN_URL=turn:turn.example.com:3478`,
   username/credential set; assert the response contains the TURN entry with
   credentials.

**Verify**: `cd apps/server && bun run test` → all pass, including 2 new.

### Step 4: Client runtime — thread ICE servers into connection acquisition

1. In `PeerSessionServices.ts`, change the signature to:

   ```ts
   readonly acquirePeerConnection: (
     iceServers: ReadonlyArray<IceServer>,
   ) => Effect.Effect<PeerConnectionHandle, PlatformError, Scope.Scope>;
   ```

   importing `IceServer` (type) from `@tether/contracts/modules/room`.
2. In `PeerSession.ts` `startPeerSession`: after `const client = yield* AppClient;`,
   fetch once per session with a safe fallback so a failed RPC never blocks a
   call:

   ```ts
   const { iceServers } = yield* client.GetIceServers().pipe(
     Effect.catchAll(() =>
       Effect.logWarning('Falling back to default ICE servers').pipe(
         Effect.as({ iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] }),
       ),
     ),
   );
   ```

   (Check whether a no-payload RPC client method is called as `GetIceServers()`
   or `GetIceServers({})` — mirror how `LeaveRoom` is invoked, or check
   `repos/effect/packages/effect/src/unstable/rpc/RpcClient.ts`.)
3. Pass `iceServers` into `makePeerSessionActor` as a new parameter and use it
   in `acquirePeerConnectionGeneration`:
   `platform.acquirePeerConnection(iceServers).pipe(...)`.

**Verify**: `bun run lint` → fails only in the web platform adapter and the
test fixture (signatures now stale) — expected; fixed next.

### Step 5: Web platform adapter — use the provided list

In `apps/web/src/modules/room/peer-session/platform.ts`, change
`acquirePeerConnection` from a constant into a function of
`iceServers: ReadonlyArray<IceServer>` returning the same
`Effect.acquireRelease`, constructing:

```ts
new RTCPeerConnection({
  iceServers: iceServers.map((server) => ({
    urls: [...server.urls],
    username: server.username,
    credential: server.credential,
  })),
})
```

(The spread is needed because `RTCIceServer.urls` wants a mutable array.)
Remove the hardcoded Google entry — the default now comes from the server (or
the client fallback in Step 4).

**Verify**: `bun run lint` → errors remain only in `PeerSession.test.ts`.

### Step 6: Fix the actor test fixture

In `PeerSession.test.ts`:

- `makeFixture`'s fake `acquirePeerConnection` becomes
  `(iceServers) => <existing acquireRelease effect>`; also record
  `operations.push('acquirePeerConnection')` as today.
- The fixture's fake `AppClient` must handle `GetIceServers` (return
  `Effect.succeed({ iceServers: [] })`) — find where the fixture builds the
  `AppClient` service and add it.
- Add one test: the actor passes the fetched list through — override the fake
  client's `GetIceServers` to return a recognizable entry, capture the
  argument in the fake `acquirePeerConnection`, assert it matches. Also assert
  a failing `GetIceServers` still results in a working session (fallback list
  used).

**Verify**: `cd packages/client-runtime && bun run test` → all pass.
`bun run test` (root) → all pass. `bun run fmt:check` → exit 0.

### Step 7: Manual smoke test

Run server + web (see commands table), join a room from two tabs, confirm the
call still connects with no env vars set (STUN default path).

**Verify**: both tabs show status "Connected".

## Test plan

- Server: 2 new `Handlers.test.ts` cases (default STUN; TURN from env) —
  Step 3.
- Client: 2 new `PeerSession.test.ts` cases (list threaded through; RPC
  failure falls back) — Step 6.
- Pattern exemplars: existing cases in the same two files.
- Verification: `bun run test` (root) → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run test` (root) exits 0, including the 4 new tests
- [ ] `bun run lint` and `bun run fmt:check` exit 0
- [ ] `grep -rn "stun.l.google.com" apps/web/src/` returns no matches (the
      hardcoded client config is gone; the string legitimately remains in
      `apps/server/src/modules/room/Handlers.ts` and `PeerSession.ts`'s
      fallback)
- [ ] `grep -n "GetIceServers" packages/contracts/src/modules/room/Rpcs.ts`
      shows the RPC registered in `RoomRpcs`
- [ ] Manual smoke test (Step 7) passed
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `Rpc.make` with no `payload` key does not typecheck in this Effect beta and
  `repos/effect/packages/effect/src/unstable/rpc/Rpc.ts` doesn't show an
  obvious no-payload form — report rather than inventing a dummy payload.
- The `Schema.optional` / `ConfigProvider` APIs differ from this plan's
  sketch and the vendored `repos/effect` source doesn't resolve it in a few
  minutes of reading.
- Threading `iceServers` requires changing `PeerSessionEventSink`, the atoms
  in `apps/web/src/modules/room/peer-session/`, or any server file beyond
  `Handlers.ts`.
- TURN credentials would end up written to any file other than the operator's
  local `.env` (never commit credential values; `.env` files are untracked).

## Maintenance notes

- **Local TURN for testing**: `docker run --rm -p 3478:3478/udp coturn/coturn
  --user=test:test123 --realm=tether.local --lt-cred-mech` then set
  `TURN_URL=turn:localhost:3478 TURN_USERNAME=test TURN_CREDENTIAL=test123`
  on the server. To *prove* TURN relaying works, temporarily construct the
  `RTCPeerConnection` with `iceTransportPolicy: 'relay'` in a scratch branch —
  the call must still connect.
- Static credentials shipped to every client are the known follow-up: coturn's
  `use-auth-secret` + time-limited HMAC credentials generated per
  `GetIceServers` call. The RPC boundary added here is exactly where that
  slots in.
- Reviewer should scrutinize: the fetch happens once per *session* (in
  `startPeerSession`), not once per generation — reconnects (plan 002) reuse
  the list, which is fine for static config but must move into
  `acquirePeerConnectionGeneration` once credentials become time-limited.
