import { it } from '@effect/vitest';
import type { WatchSessionView } from '@tether/client-runtime/modules/watch-along';
import { Effect } from 'effect';
import { assert, describe, vi } from 'vitest';

import {
  containVideoSize,
  createReceiverFrameCache,
  createReceiverFrameCacheWith,
  ReceiverFrameCacheError,
  type ReceiverFrameCacheEnvironment,
} from './receiver-frame-cache';

class FakeCanvas {
  width = 300;
  height = 150;
  readonly context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  };
  contextAvailable = true;

  getContext() {
    return this.contextAvailable ? this.context : null;
  }
}

const environment = (...canvases: FakeCanvas[]): ReceiverFrameCacheEnvironment => {
  let index = 0;
  return { createCanvas: () => canvases[index++] as unknown as HTMLCanvasElement };
};

const frame = { videoWidth: 640, videoHeight: 360 } as HTMLVideoElement;
const view = (overrides: Partial<WatchSessionView> = {}): WatchSessionView => ({
  status: 'loaded-paused',
  role: 'watcher',
  progress: 0.25,
  revision: 1,
  controlsEnabled: true,
  canPresent: false,
  bufferingReason: null,
  ...overrides,
});

describe('receiver frame cache', () => {
  it.effect('contains valid video sizes without stretching', () =>
    Effect.sync(() => {
      assert.deepStrictEqual(containVideoSize([1920, 1080], [6.5, 3.66]), [6.5, 3.65625]);
      const portrait = containVideoSize([1080, 1920], [6.5, 3.66]);
      assert.closeTo(portrait[0], 2.05875, 8);
      assert.strictEqual(portrait[1], 3.66);
      assert.deepStrictEqual(containVideoSize([0, 1], [1, 1]), [0, 0]);
      assert.deepStrictEqual(containVideoSize([1, 0], [1, 1]), [0, 0]);
      assert.deepStrictEqual(containVideoSize([1, 1], [0, 1]), [0, 0]);
      assert.deepStrictEqual(containVideoSize([1, 1], [1, 0]), [0, 0]);
    }),
  );

  it.effect('uses the browser canvas environment', () =>
    Effect.sync(() => {
      const canvases = [new FakeCanvas(), new FakeCanvas()];
      const createElement = vi.fn(() => canvases.shift() as unknown as HTMLCanvasElement);
      vi.stubGlobal('document', { createElement });
      const cache = createReceiverFrameCache();
      assert.strictEqual(createElement.mock.calls.length, 2);
      cache.dispose();
      vi.unstubAllGlobals();
    }),
  );

  it.effect('creates a cache and holds paused frames', () =>
    Effect.gen(function* () {
      const committed = new FakeCanvas();
      const candidate = new FakeCanvas();
      const cache = yield* createReceiverFrameCacheWith(environment(committed, candidate));
      assert.isFalse(cache.hasFrame());
      assert.isTrue(yield* cache.capture(frame, { presentedFrames: 1 }, view()));
      assert.isTrue(cache.hasFrame());
      assert.strictEqual(committed.width, 640);
      assert.strictEqual(committed.height, 360);
      assert.isFalse(yield* cache.capture(frame, { presentedFrames: 2 }, view()));
      assert.isFalse(
        yield* cache.capture(frame, { presentedFrames: 2 }, view({ status: 'playing' })),
      );
      assert.isTrue(
        yield* cache.capture(frame, { presentedFrames: 3 }, view({ status: 'playing' })),
      );
    }),
  );

  it.effect('commits the newest candidate when a paused seek is accepted', () =>
    Effect.gen(function* () {
      const committed = new FakeCanvas();
      const candidate = new FakeCanvas();
      const cache = yield* createReceiverFrameCacheWith(environment(committed, candidate));
      yield* cache.capture(frame, { presentedFrames: 1 }, view());
      const baseline = view();
      cache.armSeek(1, 0.8, baseline);
      assert.isFalse(yield* cache.acceptView(baseline));
      assert.isFalse(yield* cache.capture(frame, { presentedFrames: 2 }, view({ progress: 0.8 })));
      assert.isFalse(yield* cache.acceptView(view({ progress: 0.8 })));
      assert.isTrue(yield* cache.acceptView(view({ progress: 0.8, revision: 2 })));
      assert.strictEqual(committed.context.drawImage.mock.lastCall?.[0], candidate);
    }),
  );

  it.effect('accepts exactly the next frame when canonical seek state arrives first', () =>
    Effect.gen(function* () {
      const committed = new FakeCanvas();
      const cache = yield* createReceiverFrameCacheWith(environment(committed, new FakeCanvas()));
      yield* cache.capture(frame, { presentedFrames: 1 }, view());
      cache.armSeek(1, 0.8, view());
      assert.isFalse(yield* cache.acceptView(view({ progress: 0.8, revision: 2 })));
      assert.isTrue(
        yield* cache.capture(frame, { presentedFrames: 2 }, view({ progress: 0.8, revision: 2 })),
      );
      assert.isFalse(
        yield* cache.capture(frame, { presentedFrames: 3 }, view({ progress: 0.8, revision: 2 })),
      );
    }),
  );

  it.effect('clears a rejected candidate and captures one final ended frame', () =>
    Effect.gen(function* () {
      const cache = yield* createReceiverFrameCacheWith(
        environment(new FakeCanvas(), new FakeCanvas()),
      );
      yield* cache.capture(frame, { presentedFrames: 1 }, view());
      cache.armSeek(1, 0.8, view());
      yield* cache.capture(frame, { presentedFrames: 2 }, view({ progress: 0.8 }));
      assert.isFalse(yield* cache.acceptView(view({ progress: 0.25 })));
      assert.isFalse(yield* cache.capture(frame, { presentedFrames: 3 }, view()));
      yield* cache.acceptView(view({ status: 'playing' }));
      yield* cache.acceptView(view({ status: 'ended' }));
      assert.isTrue(yield* cache.capture(frame, { presentedFrames: 4 }, view({ status: 'ended' })));
      assert.isFalse(
        yield* cache.capture(frame, { presentedFrames: 5 }, view({ status: 'ended' })),
      );
    }),
  );

  it.effect('rejects invalid frames and stops after disposal', () =>
    Effect.gen(function* () {
      const committed = new FakeCanvas();
      const candidate = new FakeCanvas();
      const cache = yield* createReceiverFrameCacheWith(environment(committed, candidate));
      assert.isFalse(
        yield* cache.capture(
          { videoWidth: 0, videoHeight: 360 } as HTMLVideoElement,
          { presentedFrames: 1 },
          view(),
        ),
      );
      assert.isFalse(
        yield* cache.capture(
          { videoWidth: 640, videoHeight: 0 } as HTMLVideoElement,
          { presentedFrames: 1 },
          view(),
        ),
      );
      cache.dispose();
      cache.dispose();
      assert.strictEqual(committed.width, 0);
      assert.strictEqual(candidate.height, 0);
      assert.isFalse(yield* cache.capture(frame, { presentedFrames: 2 }, view()));
    }),
  );

  it.effect('reports canvas creation and drawing failures', () =>
    Effect.gen(function* () {
      const firstFailure = yield* Effect.flip(
        createReceiverFrameCacheWith({
          createCanvas: () => {
            throw new Error('first');
          },
        }),
      );
      assert.instanceOf(firstFailure, ReceiverFrameCacheError);

      let calls = 0;
      const secondFailure = yield* Effect.flip(
        createReceiverFrameCacheWith({
          createCanvas: () => {
            calls += 1;
            if (calls === 2) throw new Error('second');
            return new FakeCanvas() as unknown as HTMLCanvasElement;
          },
        }),
      );
      assert.instanceOf(secondFailure, ReceiverFrameCacheError);

      const noCommittedContext = new FakeCanvas();
      noCommittedContext.contextAvailable = false;
      assert.instanceOf(
        yield* Effect.flip(
          createReceiverFrameCacheWith(environment(noCommittedContext, new FakeCanvas())),
        ),
        ReceiverFrameCacheError,
      );
      const noCandidateContext = new FakeCanvas();
      noCandidateContext.contextAvailable = false;
      assert.instanceOf(
        yield* Effect.flip(
          createReceiverFrameCacheWith(environment(new FakeCanvas(), noCandidateContext)),
        ),
        ReceiverFrameCacheError,
      );

      const drawCanvas = new FakeCanvas();
      drawCanvas.context.drawImage.mockImplementationOnce(() => {
        throw new Error('draw');
      });
      const drawCache = yield* createReceiverFrameCacheWith(
        environment(drawCanvas, new FakeCanvas()),
      );
      const drawFailure = yield* Effect.flip(
        drawCache.capture(frame, { presentedFrames: 1 }, view()),
      );
      assert.strictEqual(drawFailure.operation, 'draw');

      const commitCanvas = new FakeCanvas();
      const commitCache = yield* createReceiverFrameCacheWith(
        environment(commitCanvas, new FakeCanvas()),
      );
      commitCache.armSeek(1, 0.8, view());
      yield* commitCache.capture(frame, { presentedFrames: 1 }, view({ progress: 0.8 }));
      commitCanvas.context.drawImage.mockImplementationOnce(() => {
        throw new Error('commit');
      });
      const commitFailure = yield* Effect.flip(
        commitCache.acceptView(view({ progress: 0.8, revision: 2 })),
      );
      assert.strictEqual(commitFailure.operation, 'commit');
    }),
  );
});
