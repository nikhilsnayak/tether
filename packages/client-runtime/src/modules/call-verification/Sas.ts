import { Crypto, Data, Effect } from 'effect';

export class FingerprintMissing extends Data.TaggedError('FingerprintMissing')<{
  readonly description: 'offer' | 'answer';
}> {}

// Normalized so hex case or line endings can never cause a false mismatch.
const fingerprintLines = (sdp: string): ReadonlyArray<string> =>
  sdp
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.startsWith('a=fingerprint:'));

// SDP is ASCII; TextEncoder isn't in the platform-neutral lib.
const asciiBytes = (input: string): Uint8Array =>
  Uint8Array.from(input, (char) => char.charCodeAt(0));

/** Hashes both fingerprints as received over signaling, offer first so both roles agree. */
export const deriveSas = Effect.fnUntraced(function* ({
  answerSdp,
  offerSdp,
}: {
  readonly offerSdp: string;
  readonly answerSdp: string;
}) {
  const offer = fingerprintLines(offerSdp);
  const answer = fingerprintLines(answerSdp);
  if (offer.length === 0) return yield* new FingerprintMissing({ description: 'offer' });
  if (answer.length === 0) return yield* new FingerprintMissing({ description: 'answer' });
  const crypto = yield* Crypto.Crypto;
  const input = ['tether-sas-v1', ...offer, ...answer].join('\n');
  return yield* crypto.digest('SHA-256', asciiBytes(input));
});

// Five groups of five digits: 80 bits, too long to grind a colliding certificate.
export const formatSas = (digest: Uint8Array): string => {
  const groups: Array<string> = [];
  for (let index = 0; index + 1 < 10; index += 2) {
    const value = ((digest[index] ?? 0) << 8) | (digest[index + 1] ?? 0);
    groups.push(value.toString().padStart(5, '0'));
  }
  return groups.join(' ');
};

export const deriveSasCode = (descriptions: {
  readonly offerSdp: string;
  readonly answerSdp: string;
}) => deriveSas(descriptions).pipe(Effect.map(formatSas));
