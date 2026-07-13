import { describe, expect, it } from 'vitest';

import { hasLiveRemoteVideo } from './use-remote-video-availability';

const streamWith = (track: Pick<MediaStreamTrack, 'readyState' | 'muted'>) =>
  ({ getVideoTracks: () => [track] }) as MediaStream;

describe('hasLiveRemoteVideo', () => {
  it('requires a live, unmuted remote video track', () => {
    expect(hasLiveRemoteVideo(null)).toBe(false);
    expect(hasLiveRemoteVideo(streamWith({ readyState: 'ended', muted: false }))).toBe(false);
    expect(hasLiveRemoteVideo(streamWith({ readyState: 'live', muted: true }))).toBe(false);
    expect(hasLiveRemoteVideo(streamWith({ readyState: 'live', muted: false }))).toBe(true);
  });
});
