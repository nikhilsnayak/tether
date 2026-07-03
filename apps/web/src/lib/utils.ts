const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

// getRandomValues (unlike crypto.randomUUID) works in non-secure contexts.
const randomCode = (length: number) => {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => ALPHABET[byte % 26]).join('');
};

export const generateRoomId = () => `${randomCode(3)}-${randomCode(4)}-${randomCode(3)}`;

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

export const generatePeerId = () => randomCode(12);
