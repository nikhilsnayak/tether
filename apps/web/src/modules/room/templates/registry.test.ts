import { RoomTemplateId } from '@tether/contracts/modules/room';
import { assert, describe, it } from 'vitest';

import { isFiniteTransform } from '../scene/config';
import { DUSK_SUITE_TEMPLATE, resolveRoomTemplate } from './registry';

describe('room template registry', () => {
  it('resolves Dusk Suite', () => {
    assert.deepStrictEqual(resolveRoomTemplate(DUSK_SUITE_TEMPLATE.id), {
      _tag: 'Supported',
      template: DUSK_SUITE_TEMPLATE,
    });
  });

  it('provides a lazy scene and every required finite anchor', () => {
    assert.strictEqual(DUSK_SUITE_TEMPLATE.scene.$$typeof, Symbol.for('react.lazy'));
    assert.deepStrictEqual(Object.keys(DUSK_SUITE_TEMPLATE.anchors).sort(), [
      'audio',
      'console',
      'display',
      'door',
      'warmLight',
      'window',
    ]);
    assert.isTrue(Object.values(DUSK_SUITE_TEMPLATE.anchors).every(isFiniteTransform));
  });

  it('keeps template IDs unique', () => {
    const templates = [DUSK_SUITE_TEMPLATE];
    assert.strictEqual(new Set(templates.map(({ id }) => id)).size, templates.length);
  });

  it('requires an update for an unknown template', () => {
    const roomTemplateId = RoomTemplateId.make('future-suite');
    assert.deepStrictEqual(resolveRoomTemplate(roomTemplateId), {
      _tag: 'UpdateRequired',
      roomTemplateId,
    });
  });
});
