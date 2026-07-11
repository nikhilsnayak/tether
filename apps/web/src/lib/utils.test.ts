import { assert, describe, it } from 'vitest';

import { generatePeerId } from './utils';

describe('web id generation', () => {
  it('generates a 12-letter peer id', () => {
    assert.match(generatePeerId(), /^[a-z]{12}$/);
  });
});
