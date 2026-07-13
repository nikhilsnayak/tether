import { RoomTemplateId } from '@tether/contracts/modules/room';
import { assert, describe, it, vi } from 'vitest';

import { isFiniteTransform } from '../scene/config';
import { DUSK_SUITE_TEMPLATE, resolveRoomTemplate } from './registry';

vi.mock('../scene/dusk-suite-scene', () => ({ default: () => null }));

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
    assert.isTrue(
      [
        DUSK_SUITE_TEMPLATE.camera.landscape,
        DUSK_SUITE_TEMPLATE.camera.portrait,
        DUSK_SUITE_TEMPLATE.camera.outside,
      ].every((framing) =>
        [...framing.position, ...framing.target, framing.fieldOfView].every(Number.isFinite),
      ),
    );
  });

  it('loads the bundled Dusk Suite scene', async () => {
    const lazyScene = DUSK_SUITE_TEMPLATE.scene as unknown as {
      readonly _payload: { readonly _result: () => Promise<{ readonly default: unknown }> };
    };

    const sceneModule = await lazyScene._payload._result();
    assert.isFunction(sceneModule.default);
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
