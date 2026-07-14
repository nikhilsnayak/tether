import { Crypto, Effect, Layer } from 'effect';

interface RuntimeWebCrypto {
  readonly getRandomValues: <T extends Uint8Array>(array: T) => T;
  readonly subtle: {
    readonly digest: (algorithm: string, data: Uint8Array) => Promise<ArrayBuffer>;
  };
}

interface RuntimeGlobals {
  readonly crypto: RuntimeWebCrypto;
}

const runtime = globalThis as typeof globalThis & RuntimeGlobals;

export const webCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => runtime.crypto.getRandomValues(new Uint8Array(size)),
    digest: (algorithm, data) =>
      Effect.promise(
        async () => new Uint8Array(await runtime.crypto.subtle.digest(algorithm, data)),
      ),
  }),
);
