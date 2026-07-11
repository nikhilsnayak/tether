import { assert, describe, it } from '@effect/vitest';
import { Crypto, Effect, Layer } from 'effect';
import { expect } from 'vitest';

import { formatRoomCodeInput, generatePeerId } from './RoomCodes';

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

describe('generatePeerId', () => {
  it.effect('produces 12 lowercase letters', () =>
    Effect.gen(function* () {
      const peerId = yield* generatePeerId;
      assert.match(peerId, /^[a-z]{12}$/);
    }).pipe(Effect.provide(webCrypto)),
  );
});

describe('formatRoomCodeInput', () => {
  it('lowercases typed letters', () => {
    expect(formatRoomCodeInput('ABC')).toBe('abc');
  });

  it('inserts hyphens as groups fill up', () => {
    expect(formatRoomCodeInput('abc')).toBe('abc');
    expect(formatRoomCodeInput('abcd')).toBe('abc-d');
    expect(formatRoomCodeInput('abcdefg')).toBe('abc-defg');
    expect(formatRoomCodeInput('abcdefgh')).toBe('abc-defg-h');
    expect(formatRoomCodeInput('abcdefghij')).toBe('abc-defg-hij');
  });

  it('accepts an already formatted code unchanged', () => {
    expect(formatRoomCodeInput('zom-swaq-cwt')).toBe('zom-swaq-cwt');
  });

  it('strips separators and other non-letters from pasted codes', () => {
    expect(formatRoomCodeInput('ZOM SWAQ CWT')).toBe('zom-swaq-cwt');
    expect(formatRoomCodeInput('zom_swaq.cwt!')).toBe('zom-swaq-cwt');
    expect(formatRoomCodeInput('z1o2m3')).toBe('zom');
  });

  it('caps input at ten letters', () => {
    expect(formatRoomCodeInput('abcdefghijklmno')).toBe('abc-defg-hij');
  });

  it('lets backspace remove the last letter across a hyphen', () => {
    // Deleting the "d" from "abc-d" leaves "abc-", which must not re-stick.
    expect(formatRoomCodeInput('abc-')).toBe('abc');
  });

  it('returns an empty string for empty or letterless input', () => {
    expect(formatRoomCodeInput('')).toBe('');
    expect(formatRoomCodeInput('123-!')).toBe('');
  });
});
