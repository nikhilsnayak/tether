const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

// getRandomValues (unlike crypto.randomUUID) works in non-secure contexts.
const randomCode = (length: number) => {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => ALPHABET[byte % 26]).join('');
};

export const generateRoomId = () => `${randomCode(3)}-${randomCode(4)}-${randomCode(3)}`;

export const generatePeerId = () => randomCode(12);
