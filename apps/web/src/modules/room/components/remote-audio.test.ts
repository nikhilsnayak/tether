import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { attachRemoteAudio, createKnockPlaybackQueue, setRemoteAudioSink } from './remote-audio';

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

describe('knock playback queue', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('plays one cue per new pending peer, spaced apart in knock order', () => {
    const queue = createKnockPlaybackQueue();
    const play = vi.fn();

    queue.enqueue(['alice', 'bob']);
    queue.flush(play);
    expect(play).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(320);
    expect(play).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(320);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('does not replay a peer that is still pending', () => {
    const queue = createKnockPlaybackQueue();
    const play = vi.fn();

    queue.enqueue(['alice']);
    queue.flush(play);
    vi.advanceTimersByTime(320);
    expect(play).toHaveBeenCalledTimes(1);

    queue.enqueue(['alice']);
    queue.flush(play);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('drops a queued cue when the peer withdraws before it plays', () => {
    const queue = createKnockPlaybackQueue();
    const play = vi.fn();

    queue.enqueue(['alice', 'bob']);
    queue.flush(play);
    expect(play).toHaveBeenCalledTimes(1);

    // Bob withdraws before his cue's turn; the scheduled cue must not fire.
    queue.enqueue(['alice']);
    vi.advanceTimersByTime(320);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('re-announces a peer that withdrew and knocked again', () => {
    const queue = createKnockPlaybackQueue();
    const play = vi.fn();

    queue.enqueue(['alice']);
    queue.flush(play);
    vi.advanceTimersByTime(320);
    expect(play).toHaveBeenCalledTimes(1);

    queue.enqueue([]);
    queue.enqueue(['alice']);
    queue.flush(play);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('pause cancels the next scheduled cue', () => {
    const queue = createKnockPlaybackQueue();
    const play = vi.fn();

    queue.enqueue(['alice', 'bob']);
    queue.flush(play);
    expect(play).toHaveBeenCalledTimes(1);

    queue.pause();
    vi.advanceTimersByTime(1_000);
    expect(play).toHaveBeenCalledTimes(1);
  });
});
