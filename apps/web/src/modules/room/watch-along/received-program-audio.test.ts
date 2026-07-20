import { assert, describe, expect, it, vi } from 'vitest';

import {
  attachReceivedProgramAudio,
  setReceivedProgramAudioSink,
  type ReceivedProgramAudioElement,
} from './received-program-audio';

const createElement = () =>
  ({
    srcObject: null,
    pause: vi.fn(),
    setSinkId: vi.fn(async () => undefined),
  }) satisfies ReceivedProgramAudioElement;

describe('received program audio', () => {
  it('normalizes the default sink and propagates selected-sink failures', async () => {
    const element = createElement();
    await setReceivedProgramAudioSink(element, 'default');
    assert.deepStrictEqual(element.setSinkId.mock.calls, [['']]);

    element.setSinkId.mockRejectedValueOnce(new Error('denied'));
    await expect(setReceivedProgramAudioSink(element, 'speaker-2')).rejects.toThrow('denied');
  });

  it('requires sink selection support only for a non-default output', async () => {
    const element = { ...createElement(), setSinkId: undefined };
    await setReceivedProgramAudioSink(element, '');
    await expect(setReceivedProgramAudioSink(element, 'speaker-2')).rejects.toThrow(
      'Selected audio output is unsupported',
    );
  });

  it('attaches only audio tracks and detaches without stopping incoming tracks', () => {
    const stopAudioTrack = vi.fn();
    const audioTrack = { stop: stopAudioTrack } as unknown as MediaStreamTrack;
    const videoTrack = {} as MediaStreamTrack;
    const source = {
      getAudioTracks: () => [audioTrack],
      getVideoTracks: () => [videoTrack],
    } as unknown as MediaStream;
    const receivedStream = {} as MediaStream;
    const createStream = vi.fn(function (tracks: MediaStreamTrack[]) {
      assert.deepStrictEqual(tracks, [audioTrack]);
      return receivedStream;
    });
    vi.stubGlobal('MediaStream', createStream);
    const element = createElement();

    const detach = attachReceivedProgramAudio(element, source);
    assert.strictEqual(element.srcObject, receivedStream);

    detach();
    assert.strictEqual(element.srcObject, null);
    assert.strictEqual(element.pause.mock.calls.length, 1);
    assert.strictEqual(stopAudioTrack.mock.calls.length, 0);
    vi.unstubAllGlobals();
  });
});
