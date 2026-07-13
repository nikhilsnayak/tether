import { describe, expect, it, vi } from 'vitest';

import { attachRemoteAudio, setRemoteAudioSink } from './remote-audio';

function fakeAudio() {
  const play = vi.fn(async () => undefined);
  const pause = vi.fn();
  const setSinkId = vi.fn(async () => undefined);
  return {
    element: {
      srcObject: null,
      play,
      pause,
      setSinkId,
    } as unknown as HTMLAudioElement,
    play,
    pause,
    setSinkId,
  };
}

describe('remote audio lifecycle', () => {
  it('attaches, plays, and detaches a stream without stopping actor-owned tracks', () => {
    const { element, play, pause } = fakeAudio();
    const stream = {} as MediaStream;
    const dispose = attachRemoteAudio(element, stream);

    expect(element.srcObject).toBe(stream);
    expect(play).toHaveBeenCalledOnce();
    dispose();
    expect(pause).toHaveBeenCalledOnce();
    expect(element.srcObject).toBeNull();
  });

  it('changes supported output sinks', () => {
    const { element, setSinkId } = fakeAudio();
    setRemoteAudioSink(element, 'speaker-2');
    expect(setSinkId).toHaveBeenCalledWith('speaker-2');
  });
});
