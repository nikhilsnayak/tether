import { assert, describe, it } from 'vitest';

import {
  canEnterConsoleFocus,
  initialConsoleFocusState,
  reduceConsoleFocus,
} from './console-focus';

const anchor = { position: [0, 0.5, -4.12] as [number, number, number], interactionRadius: 2.2 };

describe('console focus', () => {
  it('uses horizontal distance and includes the interaction boundary', () => {
    assert.isTrue(canEnterConsoleFocus({ x: 0, z: -1.92 }, anchor));
    assert.isFalse(canEnterConsoleFocus({ x: 0, z: -1.919 }, anchor));
  });

  it('enters only in range, hides tiles, and restores them on exit', () => {
    assert.strictEqual(
      reduceConsoleFocus(initialConsoleFocusState, { _tag: 'Enter' }),
      initialConsoleFocusState,
    );
    const inRange = reduceConsoleFocus(initialConsoleFocusState, {
      _tag: 'RangeChanged',
      inRange: true,
    });
    assert.strictEqual(
      reduceConsoleFocus(inRange, { _tag: 'RangeChanged', inRange: true }),
      inRange,
    );
    const focused = reduceConsoleFocus(inRange, { _tag: 'Enter' });
    assert.deepStrictEqual(focused, { inRange: true, focused: true, tilesVisible: false });
    assert.strictEqual(reduceConsoleFocus(focused, { _tag: 'Enter' }), focused);
    const revealed = reduceConsoleFocus(focused, { _tag: 'RevealTiles' });
    assert.deepStrictEqual(revealed, { ...focused, tilesVisible: true });
    assert.strictEqual(reduceConsoleFocus(revealed, { _tag: 'RevealTiles' }), revealed);
    assert.deepStrictEqual(reduceConsoleFocus(revealed, { _tag: 'Exit' }), {
      inRange: true,
      focused: false,
      tilesVisible: true,
    });
    assert.strictEqual(
      reduceConsoleFocus(initialConsoleFocusState, { _tag: 'Exit' }),
      initialConsoleFocusState,
    );
  });
});
