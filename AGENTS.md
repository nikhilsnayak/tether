## Dependencies

- No dev dependencies — everything goes under `dependencies`.
- Shared deps live in the root `package.json` catalog and are consumed via `catalog:`.
- Exception: `apps/mobile` pins `react`, `react-native`, and `@types/react` to the versions its Expo SDK ships (Expo controls them), not the catalog. Safe because `@tether/client-runtime` is React-free, so web and mobile can run different React versions.

## Vendored Repositories (`repos/`)

Read-only reference for the libraries they mirror. Don't edit them unless asked, and don't import from them — app code imports from normal package dependencies. Prefer their source and examples over web search or guesses.

## Shared Package Modules

`@tether/client-runtime` and `@tether/contracts` expose each feature as one subpath per module — `@tether/<pkg>/modules/<feature>`, resolved via a per-module `index.ts` barrel. Module symbols are never re-exported from the package root barrel (`src/index.ts`), which carries only cross-cutting core. Import feature code from its subpath, not the root.

## Effect

Read `repos/effect/LLMS.md` before writing Effect code, and treat `repos/effect/` as the source of truth for idiomatic patterns over web search or guesses.
