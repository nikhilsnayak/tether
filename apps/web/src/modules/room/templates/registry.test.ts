import { RoomTemplateId } from '@tether/contracts/modules/room';
import { assert, describe, it, vi } from 'vitest';

import { roomGameplayConfigIsWithinWireBounds } from '../scene/avatar-motion';
import {
  DAWN_ATRIUM_TEMPLATE,
  DEFAULT_WEB_ROOM_TEMPLATE,
  DUSK_SUITE_TEMPLATE,
  loadDawnAtriumScene,
  loadDuskSuiteScene,
  ROOM_TEMPLATES,
  resolveRoomTemplate,
} from './registry';

vi.mock('../scene/dawn-atrium-scene', () => ({ default: () => null }));
vi.mock('../scene/dusk-suite-scene', () => ({ default: () => null }));

describe('room template registry', () => {
  it('resolves Dusk Suite', () => {
    assert.deepStrictEqual(resolveRoomTemplate(DUSK_SUITE_TEMPLATE.id), {
      _tag: 'Supported',
      template: DUSK_SUITE_TEMPLATE,
    });
  });

  it('resolves Dawn Atrium without Watch Together', () => {
    assert.deepStrictEqual(resolveRoomTemplate(DAWN_ATRIUM_TEMPLATE.id), {
      _tag: 'Supported',
      template: DAWN_ATRIUM_TEMPLATE,
    });
    assert.deepStrictEqual(ROOM_TEMPLATES, [DUSK_SUITE_TEMPLATE, DAWN_ATRIUM_TEMPLATE]);
    assert.strictEqual(DEFAULT_WEB_ROOM_TEMPLATE, DUSK_SUITE_TEMPLATE);
    assert.isUndefined(DAWN_ATRIUM_TEMPLATE.watchAlong);
  });

  it('provides lazy scenes, valid gameplay, and finite camera framing', () => {
    for (const template of ROOM_TEMPLATES) {
      assert.strictEqual(template.scene.$$typeof, Symbol.for('react.lazy'));
      assert.isTrue(
        [template.camera.landscape, template.camera.portrait, template.camera.outside].every(
          (framing) =>
            [...framing.position, ...framing.target, framing.fieldOfView].every(Number.isFinite),
        ),
      );
      assert.isTrue(roomGameplayConfigIsWithinWireBounds(template.gameplay));
    }
  });

  it('places the watch display in the room', () => {
    const watchAlong = DUSK_SUITE_TEMPLATE.watchAlong;
    if (watchAlong === undefined) assert.fail('Dusk Suite should support watch along');
    const display = watchAlong.display;
    assert.isTrue([...display.position, ...display.size].every(Number.isFinite));
    assert.isTrue(
      [watchAlong.camera.landscape, watchAlong.camera.portrait].every((framing) =>
        [...framing.position, ...framing.target, framing.fieldOfView].every(Number.isFinite),
      ),
    );
  });

  it('loads the bundled Dusk Suite scene', async () => {
    const sceneModule = await loadDuskSuiteScene();
    assert.isFunction(sceneModule.default);
  });

  it('loads the bundled Dawn Atrium scene', async () => {
    const sceneModule = await loadDawnAtriumScene();
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
