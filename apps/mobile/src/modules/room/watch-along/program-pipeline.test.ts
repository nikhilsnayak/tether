import { assert, describe, it } from 'vitest';

import {
  classifyProgramPipelineSignal,
  hasPlayerReadinessExpired,
  markPlayerReady,
  startPlayerReadinessDeadline,
  type ProgramPipelineSignal,
} from './program-pipeline';

describe('mobile program pipeline', () => {
  it('classifies fatal renderer and audio signals only for a live session', () => {
    const live = { active: true, interrupted: false, tearingDown: false };
    for (const signal of ['render-error', 'readiness-timeout', 'track-ended'] as const) {
      assert.strictEqual(classifyProgramPipelineSignal(signal, live), 'renderer');
    }
    assert.strictEqual(classifyProgramPipelineSignal('audio-error', live), 'pipeline');

    const signals: ReadonlyArray<ProgramPipelineSignal> = ['render-error', 'audio-error'];
    for (const signal of signals) {
      assert.isNull(classifyProgramPipelineSignal(signal, { ...live, active: false }));
      assert.isNull(classifyProgramPipelineSignal(signal, { ...live, interrupted: true }));
      assert.isNull(classifyProgramPipelineSignal(signal, { ...live, tearingDown: true }));
    }
  });

  it('tracks the native-player readiness deadline', () => {
    const deadline = startPlayerReadinessDeadline(100, 50);
    assert.deepStrictEqual(deadline, { expiresAt: 150, ready: false });
    assert.isFalse(hasPlayerReadinessExpired(deadline, 149));
    assert.isTrue(hasPlayerReadinessExpired(deadline, 150));

    const ready = markPlayerReady(deadline);
    assert.deepStrictEqual(ready, { expiresAt: 150, ready: true });
    assert.strictEqual(markPlayerReady(ready), ready);
    assert.isFalse(hasPlayerReadinessExpired(ready, 200));
  });
});
