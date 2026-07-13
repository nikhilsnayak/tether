import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRoomAudioEngine, disposeRoomAudioResources } from './room-audio';

const audioNode = () => ({
  connect: vi.fn((target: unknown) => target),
  disconnect: vi.fn(),
});

const audioContext = (rejectLifecycle: boolean) => {
  const roomOutput = { ...audioNode(), gain: { setTargetAtTime: vi.fn() } };
  const oscillator = {
    ...audioNode(),
    frequency: { value: 0 },
    start: vi.fn(),
    stop: vi.fn(),
  };
  const knockGain = {
    ...audioNode(),
    gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
  };
  return {
    close: vi.fn(() =>
      rejectLifecycle ? Promise.reject(new Error('close failed')) : Promise.resolve(),
    ),
    createGain: vi.fn().mockReturnValueOnce(roomOutput).mockReturnValueOnce(knockGain),
    createOscillator: vi.fn(() => oscillator),
    currentTime: 4,
    destination: {},
    resume: vi.fn(() =>
      rejectLifecycle ? Promise.reject(new Error('resume failed')) : Promise.resolve(),
    ),
    roomOutput,
    oscillator,
    knockGain,
  };
};

describe('room audio routing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('disconnects every node and closes the audio context', () => {
    const disconnect = vi.fn();
    const close = vi.fn(async () => undefined);

    disposeRoomAudioResources({
      context: { close },
      nodes: [{ disconnect }, { disconnect }, { disconnect }],
    });

    expect(disconnect).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([false, true])('creates and controls the room cue graph', async (rejectLifecycle) => {
    const context = audioContext(rejectLifecycle);
    vi.stubGlobal(
      'AudioContext',
      vi.fn(function AudioContextMock() {
        return context;
      }),
    );

    const engine = createRoomAudioEngine();
    engine.setMuted(true);
    engine.setMuted(false);
    engine.playKnock();
    engine.dispose();
    await Promise.resolve();

    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.roomOutput.connect).toHaveBeenCalledWith(context.destination);
    expect(context.roomOutput.gain.setTargetAtTime).toHaveBeenNthCalledWith(1, 0, 4, 0.02);
    expect(context.roomOutput.gain.setTargetAtTime).toHaveBeenNthCalledWith(2, 1, 4, 0.02);
    expect(context.knockGain.connect).toHaveBeenCalledWith(context.roomOutput);
    expect(context.oscillator.start).toHaveBeenCalledOnce();
    expect(context.oscillator.stop).toHaveBeenCalledWith(4.13);
    expect(context.close).toHaveBeenCalledOnce();
    expect(context.roomOutput.disconnect).toHaveBeenCalledOnce();
  });

  it('routes knocks through the room output mute boundary', () => {
    const context = audioContext(false);
    vi.stubGlobal(
      'AudioContext',
      vi.fn(function AudioContextMock() {
        return context;
      }),
    );

    const engine = createRoomAudioEngine();
    engine.setMuted(true);
    engine.playKnock();

    expect(context.roomOutput.gain.setTargetAtTime).toHaveBeenCalledWith(0, 4, 0.02);
    expect(context.knockGain.connect).toHaveBeenCalledWith(context.roomOutput);
  });
});
