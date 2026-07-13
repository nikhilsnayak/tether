import { assert, describe, it, vi } from 'vitest';

import { applyMediaSettings, createMediaSettingsApplicator, stopMediaStream } from './media';

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

  it('stops every stream track', () => {
    const tracks = [track(), track(), track()];
    stopMediaStream({ getTracks: () => tracks } as unknown as MediaStream);
    for (const mediaTrack of tracks) assert.strictEqual(mediaTrack.stop.mock.calls.length, 1);
  });

  it('accepts an absent stream when there is nothing to stop', () => {
    stopMediaStream(null);
  });

  it('applies current settings once to each fresh call stream', () => {
    const firstAudio = track();
    const first = {
      getAudioTracks: () => [firstAudio],
      getVideoTracks: () => [],
    } as unknown as MediaStream;
    const secondAudio = track();
    const second = {
      getAudioTracks: () => [secondAudio],
      getVideoTracks: () => [],
    } as unknown as MediaStream;
    const applicator = createMediaSettingsApplicator({ microphone: false, camera: true });

    applicator.apply(first);
    firstAudio.enabled = true;
    applicator.apply(first);
    applicator.update({ microphone: false, camera: false });
    applicator.apply(second);

    assert.isTrue(firstAudio.enabled);
    assert.isFalse(secondAudio.enabled);
  });
});
