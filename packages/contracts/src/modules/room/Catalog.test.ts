import { assert, describe, it } from '@effect/vitest';

import {
  DAWN_ATRIUM_DEFINITION,
  DAWN_ATRIUM_TEMPLATE_ID,
  DUSK_SUITE_DEFINITION,
  DUSK_SUITE_TEMPLATE_ID,
  findRoomTemplateDefinition,
  resolveRoomTemplateFeatures,
  ROOM_TEMPLATE_CATALOG,
  RoomTemplateId,
} from './index';

describe('room template catalog', () => {
  it('provides the supported templates from one stable catalog', () => {
    assert.deepStrictEqual(ROOM_TEMPLATE_CATALOG, [DAWN_ATRIUM_DEFINITION, DUSK_SUITE_DEFINITION]);
    assert.strictEqual(findRoomTemplateDefinition(DUSK_SUITE_TEMPLATE_ID), DUSK_SUITE_DEFINITION);
    assert.strictEqual(findRoomTemplateDefinition(DAWN_ATRIUM_TEMPLATE_ID), DAWN_ATRIUM_DEFINITION);
    assert.strictEqual(
      resolveRoomTemplateFeatures(DUSK_SUITE_TEMPLATE_ID),
      DUSK_SUITE_DEFINITION.features,
    );
    assert.strictEqual(
      resolveRoomTemplateFeatures(DAWN_ATRIUM_TEMPLATE_ID),
      DAWN_ATRIUM_DEFINITION.features,
    );
  });

  it('does not claim support for an unknown template', () => {
    const futureRoom = RoomTemplateId.make('future-room');
    assert.isUndefined(findRoomTemplateDefinition(futureRoom));
    assert.deepStrictEqual(resolveRoomTemplateFeatures(futureRoom), { watchAlong: false });
  });
});
