import { assert, describe, it } from '@effect/vitest';
import { Schema } from 'effect';

import {
  DAWN_ATRIUM_TEMPLATE_ID,
  DisplayName,
  DUSK_SUITE_TEMPLATE_ID,
  PeerId,
  RoomId,
  RoomTemplateId,
} from './index';
import { succeeds } from './test-helpers';

describe('room identity schemas', () => {
  it('trims and bounds the display name', () => {
    assert.isTrue(succeeds(DisplayName, 'Ada'));
    assert.isTrue(succeeds(DisplayName, '  Ada  '));
    assert.isTrue(succeeds(DisplayName, 'n'.repeat(32)));
    assert.isFalse(succeeds(DisplayName, ''));
    assert.isFalse(succeeds(DisplayName, '   '));
    assert.isFalse(succeeds(DisplayName, 'n'.repeat(33)));
    assert.strictEqual(Schema.decodeUnknownSync(DisplayName)('  Ada  '), 'Ada');
  });

  it('accepts forward-compatible room template slugs', () => {
    for (const value of ['dusk-suite', 'future2', 'a', 'a'.repeat(64)]) {
      assert.isTrue(succeeds(RoomTemplateId, value));
    }
    for (const value of [
      '',
      '-dusk',
      'dusk-',
      'dusk--suite',
      'Dusk-Suite',
      'dusk_suite',
      'a'.repeat(65),
    ]) {
      assert.isFalse(succeeds(RoomTemplateId, value));
    }
  });

  it('provides stable identifiers for the supported room templates', () => {
    assert.strictEqual(DUSK_SUITE_TEMPLATE_ID, 'dusk-suite');
    assert.strictEqual(DAWN_ATRIUM_TEMPLATE_ID, 'dawn-atrium');
  });

  it('accepts valid identifiers and rejects malformed values', () => {
    assert.isTrue(succeeds(PeerId, 'abcdefghijkl'));
    assert.isTrue(succeeds(RoomId, 'abc-defg-hij'));
    for (const value of [
      'ABCDEFGHIJKL',
      'abcdefghijk1',
      'abcdefghijk',
      'abcdefghijklm',
      ' abcdefghijkl',
    ]) {
      assert.isFalse(succeeds(PeerId, value));
    }
    for (const value of [
      'ABC-DEFG-HIJ',
      'abc_defg_hij',
      'abc-def1-hij',
      'ab-defg-hij',
      'abc-defg-hijk',
      ' abc-defg-hij',
    ]) {
      assert.isFalse(succeeds(RoomId, value));
    }
  });
});
