import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_FALLOFF, distance2d, spatialGain } from './spatial-audio';
import { createSpatialAudioGraph } from './spatial-audio-graph';

const SMOOTHING = 0.05;
const NOW = 4;

const gainNode = () => ({
  connect: vi.fn((target: unknown) => target),
  disconnect: vi.fn(),
  gain: { setTargetAtTime: vi.fn() },
});

const pannerNode = () => ({
  connect: vi.fn((target: unknown) => target),
  disconnect: vi.fn(),
  panningModel: '',
  rolloffFactor: 1,
  positionX: { value: 0 },
  positionY: { value: 0 },
  positionZ: { value: 0 },
});

const streamSource = () => ({
  connect: vi.fn((target: unknown) => target),
  disconnect: vi.fn(),
});

const listenerNode = () => ({
  positionX: { value: 0 },
  positionY: { value: 0 },
  positionZ: { value: 0 },
  forwardX: { value: 0 },
  forwardY: { value: 0 },
  forwardZ: { value: 0 },
  upX: { value: 0 },
  upY: { value: 0 },
  upZ: { value: 0 },
});

// Named nodes handed out in creation order (master gain first, then slot A for
// the first source connected, slot B for the second) — avoids array indexing,
// which noUncheckedIndexedAccess would type as possibly-undefined.
const audioContext = ({
  rejectLifecycle = false,
  withSinkId = true,
  rejectSinkId = false,
}: {
  rejectLifecycle?: boolean;
  withSinkId?: boolean;
  rejectSinkId?: boolean;
} = {}) => {
  const master = gainNode();
  const gainA = gainNode();
  const gainB = gainNode();
  const pannerA = pannerNode();
  const pannerB = pannerNode();
  const sourceA = streamSource();
  const sourceB = streamSource();
  const listener = listenerNode();
  const lifecycle = () =>
    rejectLifecycle ? Promise.reject(new Error('lifecycle failed')) : Promise.resolve();
  const context: Record<string, unknown> = {
    currentTime: NOW,
    destination: {},
    listener,
    createGain: vi
      .fn()
      .mockReturnValueOnce(master)
      .mockReturnValueOnce(gainA)
      .mockReturnValueOnce(gainB),
    createPanner: vi.fn().mockReturnValueOnce(pannerA).mockReturnValueOnce(pannerB),
    createMediaStreamSource: vi.fn().mockReturnValueOnce(sourceA).mockReturnValueOnce(sourceB),
    resume: vi.fn(lifecycle),
    close: vi.fn(lifecycle),
  };
  if (withSinkId) {
    context.setSinkId = vi.fn(() =>
      rejectSinkId ? Promise.reject(new Error('sink failed')) : Promise.resolve(),
    );
  }
  return { context, master, gainA, gainB, pannerA, pannerB, sourceA, sourceB, listener };
};

const stub = (ctx: { context: Record<string, unknown> }) =>
  vi.stubGlobal(
    'AudioContext',
    vi.fn(function AudioContextMock() {
      return ctx.context;
    }),
  );

const stream = () => ({}) as MediaStream;

describe('spatial audio graph', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resumes and wires the master gain to the destination on construction', () => {
    const ctx = audioContext();
    stub(ctx);

    createSpatialAudioGraph();

    expect(ctx.context.resume).toHaveBeenCalledOnce();
    expect(ctx.master.connect).toHaveBeenCalledWith(ctx.context.destination);
  });

  it.each([false, true])('closes the context on dispose (rejectLifecycle=%s)', async (reject) => {
    const ctx = audioContext({ rejectLifecycle: reject });
    stub(ctx);

    const graph = createSpatialAudioGraph();
    graph.dispose();
    await Promise.resolve();

    expect(ctx.context.close).toHaveBeenCalledOnce();
    expect(ctx.master.disconnect).toHaveBeenCalledOnce();
  });

  it('builds a pan-only source on the first connectVoice', () => {
    const ctx = audioContext();
    stub(ctx);

    const graph = createSpatialAudioGraph();
    graph.connectVoice(stream());

    expect(ctx.pannerA.panningModel).toBe('equalpower');
    expect(ctx.pannerA.rolloffFactor).toBe(0);
    // source → panner → gain → master
    expect(ctx.sourceA.connect).toHaveBeenCalledWith(ctx.pannerA);
    expect(ctx.pannerA.connect).toHaveBeenCalledWith(ctx.gainA);
    expect(ctx.gainA.connect).toHaveBeenCalledWith(ctx.master);
  });

  it('disposes the previous source when connectVoice is called again', () => {
    const ctx = audioContext();
    stub(ctx);

    const graph = createSpatialAudioGraph();
    graph.connectVoice(stream());
    graph.connectVoice(stream());

    expect(ctx.sourceA.disconnect).toHaveBeenCalledOnce();
    expect(ctx.pannerA.disconnect).toHaveBeenCalledOnce();
    expect(ctx.gainA.disconnect).toHaveBeenCalledOnce();
  });

  it('disconnects a cleared voice source', () => {
    const ctx = audioContext();
    stub(ctx);

    const graph = createSpatialAudioGraph();
    graph.connectVoice(stream());
    graph.disconnectVoice();

    expect(ctx.sourceA.disconnect).toHaveBeenCalledOnce();
    expect(ctx.pannerA.disconnect).toHaveBeenCalledOnce();
    expect(ctx.gainA.disconnect).toHaveBeenCalledOnce();
    graph.updateVoice({ x: 1, z: 1 }, true, { x: 0, z: 0 });
    expect(ctx.gainA.gain.setTargetAtTime).not.toHaveBeenCalled();
  });

  it('applies program gain immediately on connectProgram', () => {
    const ctx = audioContext();
    stub(ctx);

    const graph = createSpatialAudioGraph();
    graph.connectProgram(stream());

    // slot A is the program source gain; initial programSpatial × volume = 1.
    expect(ctx.gainA.gain.setTargetAtTime).toHaveBeenCalledWith(1, NOW, SMOOTHING);
  });

  it('disconnects a cleared program source', () => {
    const ctx = audioContext();
    stub(ctx);

    const graph = createSpatialAudioGraph();
    graph.connectProgram(stream());
    graph.disconnectProgram();

    expect(ctx.sourceA.disconnect).toHaveBeenCalledOnce();
    expect(ctx.pannerA.disconnect).toHaveBeenCalledOnce();
    expect(ctx.gainA.disconnect).toHaveBeenCalledOnce();
  });

  it('ignores updateVoice when no voice is connected', () => {
    const ctx = audioContext();
    stub(ctx);

    const graph = createSpatialAudioGraph();
    expect(() => graph.updateVoice({ x: 1, z: 1 }, true, { x: 0, z: 0 })).not.toThrow();
    expect(ctx.context.createPanner).not.toHaveBeenCalled();
  });

  it('positions voice at the remote and attenuates by distance when present', () => {
    const ctx = audioContext();
    stub(ctx);

    const graph = createSpatialAudioGraph();
    graph.connectVoice(stream());
    const remote = { x: 5, z: 0 };
    const listener = { x: 0, z: 0 };
    graph.updateVoice(remote, true, listener);

    expect(ctx.pannerA.positionX.value).toBe(5);
    expect(ctx.pannerA.positionZ.value).toBe(0);
    const expected = spatialGain(distance2d(remote, listener), DEFAULT_FALLOFF);
    expect(ctx.gainA.gain.setTargetAtTime).toHaveBeenCalledWith(expected, NOW, SMOOTHING);
  });

  it('collapses voice onto the listener at full gain when absent', () => {
    const ctx = audioContext();
    stub(ctx);

    const graph = createSpatialAudioGraph();
    graph.connectVoice(stream());
    graph.updateVoice({ x: 5, z: 0 }, false, { x: 2, z: 3 });

    expect(ctx.pannerA.positionX.value).toBe(2);
    expect(ctx.pannerA.positionZ.value).toBe(3);
    expect(ctx.gainA.gain.setTargetAtTime).toHaveBeenCalledWith(1, NOW, SMOOTHING);
  });

  it('ignores updateProgram when no program is connected', () => {
    const ctx = audioContext();
    stub(ctx);

    const graph = createSpatialAudioGraph();
    expect(() => graph.updateProgram({ x: 0, z: -4 }, { x: 0, z: 0 })).not.toThrow();
    expect(ctx.context.createPanner).not.toHaveBeenCalled();
  });

  it('positions the program at the screen and scales gain by distance × volume', () => {
    const ctx = audioContext();
    stub(ctx);

    const graph = createSpatialAudioGraph();
    graph.connectProgram(stream());
    graph.setProgramVolume(0.5);
    const screen = { x: 0, z: -4.61 };
    const listener = { x: 0, z: 0 };
    graph.updateProgram(screen, listener);

    expect(ctx.pannerA.positionZ.value).toBe(-4.61);
    const expected = spatialGain(distance2d(screen, listener), DEFAULT_FALLOFF) * 0.5;
    expect(ctx.gainA.gain.setTargetAtTime).toHaveBeenLastCalledWith(expected, NOW, SMOOTHING);
  });

  it('updates the listener position and orientation with an upright basis', () => {
    const ctx = audioContext();
    stub(ctx);

    const graph = createSpatialAudioGraph();
    graph.updateListener({ x: 1, z: 2 }, { forwardX: 1, forwardZ: 0 });

    expect(ctx.listener.positionX.value).toBe(1);
    expect(ctx.listener.positionZ.value).toBe(2);
    expect(ctx.listener.forwardX.value).toBe(1);
    expect(ctx.listener.forwardZ.value).toBe(0);
    expect(ctx.listener.upY.value).toBe(1);
  });

  it('is a no-op when setProgramVolume runs before a program is connected', () => {
    const ctx = audioContext();
    stub(ctx);

    const graph = createSpatialAudioGraph();
    expect(() => graph.setProgramVolume(0.3)).not.toThrow();
    // only the master gain was created; no source gain touched
    expect(ctx.context.createGain).toHaveBeenCalledOnce();
  });

  it('clamps a non-finite volume to full', () => {
    const ctx = audioContext();
    stub(ctx);

    const graph = createSpatialAudioGraph();
    graph.connectProgram(stream());
    graph.setProgramVolume(Number.NaN);

    expect(ctx.gainA.gain.setTargetAtTime).toHaveBeenLastCalledWith(1, NOW, SMOOTHING);
  });

  it('mutes and unmutes the master gain', () => {
    const ctx = audioContext();
    stub(ctx);

    const graph = createSpatialAudioGraph();
    graph.setMasterMuted(true);
    graph.setMasterMuted(false);

    expect(ctx.master.gain.setTargetAtTime).toHaveBeenNthCalledWith(1, 0, NOW, SMOOTHING);
    expect(ctx.master.gain.setTargetAtTime).toHaveBeenNthCalledWith(2, 1, NOW, SMOOTHING);
  });

  it('does not call setSinkId for an empty id', () => {
    const ctx = audioContext();
    stub(ctx);

    const graph = createSpatialAudioGraph();
    graph.setSinkId('');

    expect(ctx.context.setSinkId).not.toHaveBeenCalled();
  });

  it('routes a non-empty id to AudioContext.setSinkId, swallowing rejection', async () => {
    const ctx = audioContext({ rejectSinkId: true });
    stub(ctx);

    const graph = createSpatialAudioGraph();
    graph.setSinkId('speaker-2');
    await Promise.resolve();

    expect(ctx.context.setSinkId).toHaveBeenCalledWith('speaker-2');
  });

  it('is a no-op when the context lacks setSinkId', () => {
    const ctx = audioContext({ withSinkId: false });
    stub(ctx);

    const graph = createSpatialAudioGraph();
    expect(() => graph.setSinkId('speaker-2')).not.toThrow();
  });

  it('disconnects both sources and the master on dispose', () => {
    const ctx = audioContext();
    stub(ctx);

    const graph = createSpatialAudioGraph();
    graph.connectVoice(stream());
    graph.connectProgram(stream());
    graph.dispose();

    expect(ctx.sourceA.disconnect).toHaveBeenCalledOnce();
    expect(ctx.sourceB.disconnect).toHaveBeenCalledOnce();
    expect(ctx.master.disconnect).toHaveBeenCalledOnce();
  });

  it('makes source and spatial updates no-ops after dispose', () => {
    const ctx = audioContext();
    stub(ctx);

    const graph = createSpatialAudioGraph();
    graph.dispose();

    graph.connectVoice(stream());
    graph.disconnectVoice();
    graph.connectProgram(stream());
    graph.disconnectProgram();
    graph.setProgramVolume(0.5);
    graph.updateVoice({ x: 1, z: 1 }, true, { x: 0, z: 0 });
    graph.updateProgram({ x: 1, z: 1 }, { x: 0, z: 0 });
    graph.updateListener({ x: 1, z: 1 }, { forwardX: 0, forwardZ: -1 });
    graph.dispose();

    expect(ctx.context.createMediaStreamSource).not.toHaveBeenCalled();
    expect(ctx.listener.positionX.value).toBe(0);
    expect(ctx.master.disconnect).toHaveBeenCalledOnce();
    expect(ctx.context.close).toHaveBeenCalledOnce();
  });
});
