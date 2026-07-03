import { describe, expect, it } from 'vitest';

import { formatRoomCodeInput, generatePeerId, generateRoomId } from './utils';

describe('generateRoomId', () => {
  it('produces the xxx-xxxx-xxx shape', () => {
    expect(generateRoomId()).toMatch(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
  });
});

describe('generatePeerId', () => {
  it('produces 12 lowercase letters', () => {
    expect(generatePeerId()).toMatch(/^[a-z]{12}$/);
  });
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
