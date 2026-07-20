import { resolveRoomFeatureManifest } from '@tether/client-runtime/modules/room-template';
import { RoomTemplateId } from '@tether/contracts/modules/room';
import { assert, describe, it, vi } from 'vitest';

import { roomGameplayConfigIsWithinWireBounds } from '../scene/avatar-motion';
import { DUSK_SUITE_TEMPLATE, loadDuskSuiteScene, resolveRoomTemplate } from './registry';

vi.mock('../scene/dusk-suite-scene', () => ({ default: () => null }));

describe('room template registry', () => {
  it('resolves Dusk Suite', () => {
    assert.deepStrictEqual(resolveRoomTemplate(DUSK_SUITE_TEMPLATE.id), {
      _tag: 'Supported',
      template: DUSK_SUITE_TEMPLATE,
    });
  });

  it('provides a lazy scene and finite camera framing', () => {
    assert.strictEqual(DUSK_SUITE_TEMPLATE.scene.$$typeof, Symbol.for('react.lazy'));
    assert.isTrue(
      [
        DUSK_SUITE_TEMPLATE.camera.landscape,
        DUSK_SUITE_TEMPLATE.camera.portrait,
        DUSK_SUITE_TEMPLATE.camera.outside,
      ].every((framing) =>
        [...framing.position, ...framing.target, framing.fieldOfView].every(Number.isFinite),
      ),
    );
    assert.isTrue(roomGameplayConfigIsWithinWireBounds(DUSK_SUITE_TEMPLATE.gameplay));
  });

  it('provides reachable spatial anchors for every watch-capable template', () => {
    const templates = [DUSK_SUITE_TEMPLATE];
    for (const template of templates) {
      if (!resolveRoomFeatureManifest(template.id).watchAlong) continue;
      const capability = template.watchAlong;
      assert.isDefined(capability);
      const closestX = Math.min(
        template.gameplay.walkableBounds.maxX,
        Math.max(template.gameplay.walkableBounds.minX, capability.console.position[0]),
      );
      const closestZ = Math.min(
        template.gameplay.walkableBounds.maxZ,
        Math.max(template.gameplay.walkableBounds.minZ, capability.console.position[2]),
      );
      assert.isAtMost(
        Math.hypot(
          closestX - capability.console.position[0],
          closestZ - capability.console.position[2],
        ),
        capability.console.interactionRadius,
      );
    }
  });

  it('loads the bundled Dusk Suite scene', async () => {
    const sceneModule = await loadDuskSuiteScene();
    assert.isFunction(sceneModule.default);
  });

  it('requires an update for an unknown template', () => {
    const roomTemplateId = RoomTemplateId.make('future-suite');
    assert.deepStrictEqual(resolveRoomTemplate(roomTemplateId), {
      _tag: 'UpdateRequired',
      roomTemplateId,
    });
  });
});
