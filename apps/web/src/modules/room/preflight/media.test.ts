import { assert, describe, it, vi } from 'vitest';

import { applyMediaSettings, stopMediaStream } from './media';

const track = () => ({ enabled: true, stop: vi.fn() });

describe('media preflight helpers', () => {
  it('applies initial media settings', () => {
    const audio = track();
    const video = track();
    const stream = {
      getAudioTracks: () => [audio],
      getVideoTracks: () => [video],
    } as unknown as MediaStream;
    applyMediaSettings(stream, { microphone: false, camera: false });
    assert.isFalse(audio.enabled);
    assert.isFalse(video.enabled);
  });

  it('applies mixed media settings and can re-enable tracks', () => {
    const audio = track();
    const video = { enabled: false, stop: vi.fn() };
    const stream = {
      getAudioTracks: () => [audio],
      getVideoTracks: () => [video],
    } as unknown as MediaStream;
    applyMediaSettings(stream, { microphone: true, camera: false });
    assert.isTrue(audio.enabled);
    assert.isFalse(video.enabled);
    applyMediaSettings(stream, { microphone: false, camera: true });
    assert.isFalse(audio.enabled);
    assert.isTrue(video.enabled);
  });

  it('stops every stream track', () => {
    const tracks = [track(), track(), track()];
    stopMediaStream({ getTracks: () => tracks } as unknown as MediaStream);
    for (const mediaTrack of tracks) assert.strictEqual(mediaTrack.stop.mock.calls.length, 1);
  });

  it('accepts an absent stream when there is nothing to stop', () => {
    stopMediaStream(null);
  });
});
