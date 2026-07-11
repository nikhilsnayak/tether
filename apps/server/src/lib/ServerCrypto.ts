import * as BunCrypto from '@effect/platform-bun/BunCrypto';

// The single place the server picks a Crypto implementation. Bun's layer runs
// on `node:crypto`, so it is a portable leaf that also loads under vitest
// (Node). The deep import skips the @effect/platform-bun barrel, which pulls
// `bun`-only modules that the test runner cannot resolve.
export const layer = BunCrypto.layer;
