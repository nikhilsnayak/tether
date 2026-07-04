<p align="center">
  <img src="assets/tether-mark.svg" width="88" height="88" alt="Tether logo" />
</p>

<h1 align="center">Tether</h1>

<p align="center">
  Private, account-free video calls for two people.
  <br />
  Peer-to-peer media, ephemeral chat, and a safety code you can verify aloud.
</p>

<p align="center">
  <a href="https://tether.nikhilsnayak.dev"><strong>Open Tether</strong></a>
  ·
  <a href="https://github.com/nikhilsnayak/tether/issues">Report an issue</a>
</p>

<p align="center">
  <a href="https://github.com/nikhilsnayak/tether/actions/workflows/ci.yml"><img src="https://github.com/nikhilsnayak/tether/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-f06a32" alt="MIT license" /></a>
</p>

> [!NOTE]
> Tether is a production beta. The hosted web application supports real cross-network calls.
> The Android client has reached feature parity and is distributed as an Expo development build
> while it is validated for release.

## Features

- **Private rooms for two.** Create a short room code, share the invite link, and connect without an account or lobby.
- **Web and Android clients.** The same room works from a browser or the native app, and room links open directly in the app when it is installed (Android App Links).
- **Peer-to-peer video and audio.** Camera and microphone media use WebRTC, with in-call mic, camera, speaker, and audio-output controls.
- **Ephemeral chat.** Messages travel over the call's encrypted WebRTC data channel and disappear when the session ends.
- **Verifiable safety codes.** Both callers can compare a code derived from the negotiated DTLS fingerprints to detect signaling-path fingerprint substitution.
- **Resilient sessions.** Tether reconnects failed peer connections, rejects stale events, recovers stalled negotiation, and isolates chat-channel closure without interrupting media or invalidating the safety code.
- **Configurable connectivity.** STUN works out of the box; deployments can add TURN for networks that cannot establish a direct path.

## Privacy and security

Tether separates signaling from call content:

- The signaling server relays room membership, SDP, and ICE messages. It does not receive decoded camera, microphone, or chat content.
- Audio, video, and chat are encrypted by WebRTC. They normally travel directly between callers; when TURN is configured, the relay forwards encrypted packets.
- Rooms and signaling state are held in memory and removed when callers leave. Tether has no account system, call history, or message database.
- Each room admits at most two peers. Private session tokens authorize signaling and leave operations after a caller joins.
- The server validates RPC payloads, rate-limits signaling per member, and caps live rooms.

The safety code is meaningful only when both callers compare it through a separate trusted channel, such as reading it aloud. It does not protect a compromised browser, device, or copy of the client application.

## How it works

```mermaid
flowchart LR
    A[Caller A] <-->|Effect RPC over WebSocket| S[Signaling server]
    B[Caller B] <-->|Effect RPC over WebSocket| S
    A <-->|Encrypted WebRTC media and chat| B
    A -.->|Optional encrypted relay| T[TURN server]
    T -.-> B
```

The Bun server exposes an Effect RPC endpoint over WebSocket. A streaming `OpenRoomSession` call represents both room membership and the server-to-client event channel; unary RPCs carry ICE and session-description signals and handle explicit departure.

On the client, room events, WebRTC callbacks, timers, and UI commands enter one serialized peer-session actor. That actor owns negotiation state and scoped resources, preventing concurrent callbacks from racing connection state. The implementation is React-free and platform-neutral; the web and mobile apps each supply a thin WebRTC adapter and UI on top of the shared runtime.

## Quick start

### Requirements

- [Bun](https://bun.sh/) 1.3.14 or newer
- A modern browser with WebRTC and camera/microphone access

```sh
git clone https://github.com/nikhilsnayak/tether.git
cd tether
bun install
cp apps/web/.env.example apps/web/.env
bun run dev --filter=server --filter=web
```

Open `http://localhost:5173` in two tabs, create a room, and join it from the second tab. Localhost is treated as a secure browser context, so camera and microphone APIs are available during development.

## Configuration

The default configuration runs locally without additional services.

### Server

| Variable          | Default                        | Purpose                                            |
| ----------------- | ------------------------------ | -------------------------------------------------- |
| `HOST`            | `0.0.0.0`                      | HTTP server bind address                           |
| `PORT`            | `8008`                         | HTTP and WebSocket server port                     |
| `CORS_ORIGIN`     | `http://localhost:5173`        | Comma-separated browser origins allowed to connect |
| `STUN_URLS`       | `stun:stun.l.google.com:19302` | Comma-separated STUN server URLs                   |
| `TURN_URL`        | unset                          | Optional TURN server URL                           |
| `TURN_USERNAME`   | unset                          | Username for the configured TURN server            |
| `TURN_CREDENTIAL` | unset                          | Credential for the configured TURN server          |

Set all three TURN variables together. The current server distributes operator-managed TURN credentials to connected clients, so use scoped, short-lived credentials in exposed deployments where possible.

### Web

| Variable          | Default                   | Purpose                                          |
| ----------------- | ------------------------- | ------------------------------------------------ |
| `VITE_SERVER_URL` | `ws://localhost:8008/rpc` | Full WebSocket URL of the signaling RPC endpoint |

Production browser deployments require HTTPS and a corresponding `wss://` signaling URL for camera and microphone access.

### Mobile

| Variable                 | Default                                    | Purpose                                          |
| ------------------------ | ------------------------------------------ | ------------------------------------------------ |
| `EXPO_PUBLIC_SERVER_URL` | `wss://tether-server.nikhilsnayak.dev/rpc` | Full WebSocket URL of the signaling RPC endpoint |
| `EXPO_PUBLIC_WEB_URL`    | `https://tether.nikhilsnayak.dev`          | Web origin used for shareable room links         |

The app uses `react-native-webrtc`, so it runs in an Expo development build rather than Expo Go:

```sh
cd apps/mobile
cp .env.example .env
bunx eas-cli build --profile development --platform android
bun run dev
```

Room links open in the app through Android App Links. The web deployment serves the matching
[`assetlinks.json`](apps/web/public/.well-known/assetlinks.json), which must list the SHA-256
fingerprint of the Android signing certificate (`bunx eas-cli credentials -p android`).

## Architecture

Tether is a Bun workspace managed with Turborepo.

```text
apps/
  server/          Bun HTTP server and Effect RPC signaling relay
  web/             React 19, Vite, TanStack Router, and browser WebRTC adapter
  mobile/          Expo + react-native-webrtc client on the shared peer-session runtime
packages/
  contracts/       Shared Effect Schema models and RPC contracts
  client-runtime/  React-free peer-session actor and platform service interfaces
  ui/              Shared React components and design tokens
e2e/               Playwright browser tests for complete two-peer flows
```

The main implementation boundaries are:

- [`apps/server/src/modules/room`](apps/server/src/modules/room) — ephemeral room membership, authenticated signaling, limits, and event delivery.
- [`packages/client-runtime/src/modules/room`](packages/client-runtime/src/modules/room) — negotiation, reconnection, safety-code derivation, chat, and resource ownership.
- [`apps/web/src/modules/room`](apps/web/src/modules/room) — browser WebRTC integration and the call interface.
- [`apps/mobile/src/modules/room`](apps/mobile/src/modules/room) — react-native-webrtc integration and the native call interface.
- [`packages/contracts/src/modules/room`](packages/contracts/src/modules/room) — shared wire schemas and RPC definitions.

### Technology

- Effect 4 and Effect RPC
- TypeScript 6
- Bun and Turborepo
- React 19 and Vite
- TanStack Router
- Expo and React Native
- Tailwind CSS 4
- Vitest and Playwright
- oxlint and oxfmt

## Development

Install the Playwright browser once before running the complete test suite:

```sh
cd e2e
bun x playwright install chromium
cd ..
```

Then run the repository checks from the root:

```sh
bun run lint
bun run fmt:check
bun run test
bun run build
```

The test suite covers room-capacity invariants, authenticated signaling, rate limits, ICE and TURN configuration, peer-session state transitions, resource cleanup, safety-code agreement, complete two-peer calls, chat-channel isolation, media controls, and peer-connection recovery.

## Roadmap

- Release the Android app beyond internal development builds.
- Add watch-along media as another negotiated track on the existing connection.
- Support short-lived TURN credentials instead of static operator-managed secrets.

## Contributing

Issues and pull requests are welcome. For substantial changes, open an issue first so the behavior and scope can be agreed before implementation.

Keep changes focused, follow the existing package boundaries, and run lint, formatting, tests, and the build before opening a pull request.

## License

Tether is available under the [MIT License](LICENSE).
