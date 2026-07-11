import { Crypto, Effect } from 'effect';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

// Formatted length of xxx-xxxx-xxx.
export const ROOM_CODE_LENGTH = 12;

// Room IDs are minted server-side (see contracts RoomCodes); the client only
// mints its own peer identity.
const randomCode = Effect.fnUntraced(function* (length: number) {
  const crypto = yield* Crypto.Crypto;
  const bytes = yield* crypto.randomBytes(length);
  return Array.from(bytes, (byte) => ALPHABET[byte % 26]).join('');
});

export const generatePeerId = randomCode(12);

// Normalizes a typed/pasted room code to the xxx-xxxx-xxx shape: lowercases,
// drops anything but letters, and re-inserts the hyphens as groups fill up.
export const formatRoomCodeInput = (raw: string) => {
  const letters = raw
    .toLowerCase()
    .replaceAll(/[^a-z]/g, '')
    .slice(0, 10);
  return [letters.slice(0, 3), letters.slice(3, 7), letters.slice(7, 10)]
    .filter((group) => group.length > 0)
    .join('-');
};
