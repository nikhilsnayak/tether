## Dependencies

- No dev dependencies — everything goes under `dependencies`.
- Shared deps live in the root `package.json` catalog and are consumed via `catalog:`.
- `apps/mobile` pins `react-native` and `@types/react`; its catalog React version must remain aligned with Expo.
- Keep Bun's hoisted linker: Expo autolinking requires one physical copy of native modules.

## Vendored Repositories (`repos/`)

Read-only reference for the libraries they mirror. Don't edit them unless asked, and don't import from them — app code imports from normal package dependencies. Prefer their source and examples over web search or guesses.

## Shared Package Modules

`@tether/client-runtime` and `@tether/contracts` expose each feature as one subpath per module — `@tether/<pkg>/modules/<feature>`, resolved via a per-module `index.ts` barrel. Module symbols are never re-exported from the package root barrel (`src/index.ts`), which carries only cross-cutting core. Import feature code from its subpath, not the root.

## Networking

- Direct peer-to-peer call content is a permanent product invariant. Never add TURN, a media relay,
  or any fallback that routes voice, video, chat, avatar state, or Watch Together media through a
  third party.
- STUN may be used only for address discovery. If the peers cannot establish a direct WebRTC path,
  the call must fail rather than fall back to a relay.
- The Tether server may coordinate admission and exchange signaling data before detachment, but it
  must never enter the call-content path.

## Effect

Read `repos/effect/LLMS.md` before writing Effect code, and treat `repos/effect/` as the source of truth for idiomatic patterns over web search or guesses.

## React

- React Compiler is enabled. Do not use `useMemo`, `useCallback`, or `memo`; write direct values and functions and let the compiler optimize them.
