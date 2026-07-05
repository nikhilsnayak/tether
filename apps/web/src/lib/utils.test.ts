import { assert, describe, it } from 'vitest';

import { generatePeerId, generateRoomId } from './utils';

describe('web id generation', () => {
  it('generates a formatted room code', () => {
    assert.match(generateRoomId(), /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
  });

  it('generates a 12-letter peer id', () => {
    assert.match(generatePeerId(), /^[a-z]{12}$/);
  });
});
