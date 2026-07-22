import { assert, describe, it } from '@effect/vitest';
import { DUSK_SUITE_TEMPLATE_ID, RoomTemplateId } from '@tether/contracts/modules/room';

import { resolveRoomFeatureManifest } from './Manifest';

describe('resolveRoomFeatureManifest', () => {
  it('enables watch-along for the dusk-suite template', () => {
    assert.deepStrictEqual(resolveRoomFeatureManifest(DUSK_SUITE_TEMPLATE_ID), {
      watchAlong: true,
    });
  });

  it('disables every optional feature for an unknown template', () => {
    assert.deepStrictEqual(resolveRoomFeatureManifest(RoomTemplateId.make('unknown-template')), {
      watchAlong: false,
    });
  });
});
