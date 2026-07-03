import { assert, describe, it } from '@effect/vitest';
import { Crypto, Effect, Layer } from 'effect';

import { deriveSasCode, FingerprintMissing } from './Sas';

// No DOM lib in this tsconfig, so the Web Crypto global is typed by hand.
const webCryptoApi = (
  globalThis as unknown as {
    readonly crypto: {
      readonly getRandomValues: <T extends Uint8Array>(array: T) => T;
      readonly subtle: {
        readonly digest: (algorithm: string, data: Uint8Array) => Promise<ArrayBuffer>;
      };
    };
  }
).crypto;

const webCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => webCryptoApi.getRandomValues(new Uint8Array(size)),
    digest: (algorithm, data) =>
      Effect.promise(async () => new Uint8Array(await webCryptoApi.subtle.digest(algorithm, data))),
  }),
);

const sdpWith = (fingerprint: string) =>
  [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=-',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    `a=fingerprint:sha-256 ${fingerprint}`,
    '',
  ].join('\r\n');

const offerSdp = sdpWith(
  '4A:AD:B9:B1:3F:82:18:3B:54:02:12:DF:3E:5D:49:6B:19:E5:7C:AB:11:22:33:44:55:66:77:88:99:AA:BB:CC',
);
const answerSdp = sdpWith(
  '7B:8C:9D:AE:BF:C0:D1:E2:F3:04:15:26:37:48:59:6A:7B:8C:9D:AE:BF:C0:D1:E2:F3:04:15:26:37:48:59:6A',
);

describe('deriveSasCode', () => {
  it.effect('both role perspectives derive the same spoken code', () =>
    Effect.gen(function* () {
      const fromOfferer = yield* deriveSasCode({ offerSdp, answerSdp });
      const fromAnswerer = yield* deriveSasCode({ offerSdp, answerSdp });

      assert.strictEqual(fromOfferer, fromAnswerer);
      assert.match(fromOfferer, /^\d{5}( \d{5}){4}$/);
    }).pipe(Effect.provide(webCrypto)),
  );

  it.effect('is insensitive to fingerprint hex case', () =>
    Effect.gen(function* () {
      const upper = yield* deriveSasCode({ offerSdp, answerSdp });
      const lower = yield* deriveSasCode({
        offerSdp: offerSdp.toLowerCase(),
        answerSdp: answerSdp.toLowerCase(),
      });

      assert.strictEqual(upper, lower);
    }).pipe(Effect.provide(webCrypto)),
  );

  it.effect('a substituted certificate changes the code', () =>
    Effect.gen(function* () {
      const genuine = yield* deriveSasCode({ offerSdp, answerSdp });
      const tampered = yield* deriveSasCode({
        offerSdp,
        answerSdp: answerSdp.replace('7B:8C', 'FF:FF'),
      });

      assert.notStrictEqual(genuine, tampered);
    }).pipe(Effect.provide(webCrypto)),
  );

  it.effect('swapped roles produce a different code', () =>
    Effect.gen(function* () {
      const ordered = yield* deriveSasCode({ offerSdp, answerSdp });
      const reversed = yield* deriveSasCode({ offerSdp: answerSdp, answerSdp: offerSdp });

      assert.notStrictEqual(ordered, reversed);
    }).pipe(Effect.provide(webCrypto)),
  );

  it.effect('fails when a description carries no fingerprint', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(deriveSasCode({ offerSdp, answerSdp: 'v=0\r\n' }));

      assert.instanceOf(error, FingerprintMissing);
      assert.strictEqual(error.description, 'answer');
    }).pipe(Effect.provide(webCrypto)),
  );
});
