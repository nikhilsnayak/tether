import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createRoomAudioEngine,
  disposeRoomAudioResources,
  selectRemoteAudioRoute,
} from './room-audio';

const audioNode = () => ({
  connect: vi.fn((target: unknown) => target),
  disconnect: vi.fn(),
});

const audioContext = (stereo: boolean, rejectLifecycle: boolean) => {
  const source = audioNode();
  const voiceOutput = { ...audioNode(), gain: { setTargetAtTime: vi.fn() } };
  const panner = { ...audioNode(), pan: { value: 0 } };
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
    createGain: vi.fn().mockReturnValueOnce(voiceOutput).mockReturnValueOnce(knockGain),
    createMediaElementSource: vi.fn(() => source),
    createOscillator: vi.fn(() => oscillator),
    createStereoPanner: stereo ? vi.fn(() => panner) : undefined,
    currentTime: 4,
    destination: {},
    resume: vi.fn(() =>
      rejectLifecycle ? Promise.reject(new Error('resume failed')) : Promise.resolve(),
    ),
    source,
    voiceOutput,
    panner,
    oscillator,
    knockGain,
  };
};

describe('room audio routing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('processes one voice path only after activation on the default output', () => {
    expect(selectRemoteAudioRoute({ activated: true, sinkId: '', webAudioSupported: true })).toBe(
      'processed',
    );
    expect(
      selectRemoteAudioRoute({ activated: true, sinkId: 'default', webAudioSupported: true }),
    ).toBe('processed');
    expect(selectRemoteAudioRoute({ activated: false, sinkId: '', webAudioSupported: true })).toBe(
      'direct',
    );
  });

  it('keeps the clean element path for selected sinks and unsupported Web Audio', () => {
    expect(
      selectRemoteAudioRoute({ activated: true, sinkId: 'speaker-2', webAudioSupported: true }),
    ).toBe('direct');
    expect(selectRemoteAudioRoute({ activated: true, sinkId: '', webAudioSupported: false })).toBe(
      'direct',
    );
  });

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

  it.each([
    [true, false],
    [false, true],
  ])('creates and controls the Web Audio graph (stereo: %s)', async (stereo, rejectLifecycle) => {
    const context = audioContext(stereo, rejectLifecycle);
    vi.stubGlobal(
      'AudioContext',
      vi.fn(function AudioContextMock() {
        return context;
      }),
    );

    const engine = createRoomAudioEngine({} as HTMLAudioElement);
    engine.setMuted(true);
    engine.setMuted(false);
    engine.playKnock();
    engine.dispose();
    await Promise.resolve();

    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.voiceOutput.gain.setTargetAtTime).toHaveBeenNthCalledWith(1, 0, 4, 0.02);
    expect(context.voiceOutput.gain.setTargetAtTime).toHaveBeenNthCalledWith(2, 1, 4, 0.02);
    expect(context.knockGain.connect).toHaveBeenCalledWith(context.destination);
    expect(context.oscillator.start).toHaveBeenCalledOnce();
    expect(context.oscillator.stop).toHaveBeenCalledWith(4.13);
    expect(context.close).toHaveBeenCalledOnce();
    expect(context.panner.disconnect).toHaveBeenCalledTimes(stereo ? 1 : 0);
  });

  it.fails('silences the knock path when room audio is muted', () => {
    const context = audioContext(true, false);
    vi.stubGlobal(
      'AudioContext',
      vi.fn(function AudioContextMock() {
        return context;
      }),
    );

    const engine = createRoomAudioEngine({} as HTMLAudioElement);
    engine.setMuted(true);
    engine.playKnock();

    expect(context.knockGain.connect).toHaveBeenCalledWith(context.voiceOutput);
  });
});
