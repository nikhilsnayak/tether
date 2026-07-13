import { describe, expect, it, vi } from 'vitest';

import { containedVideoSize, disposeRemoteVideoSurface } from './remote-media';

describe('containedVideoSize', () => {
  it('letterboxes portrait video without cropping', () => {
    expect(containedVideoSize(1080, 1920, 16, 9)).toEqual([5.0625, 9]);
  });

  it('pillarboxes extra-wide video without cropping', () => {
    expect(containedVideoSize(2560, 1080, 16, 9)).toEqual([16, 6.75]);
  });

  it('fills a matching display', () => {
    expect(containedVideoSize(1920, 1080, 16, 9)).toEqual([16, 9]);
  });

  it('detaches video and disposes its texture without stopping stream tracks', () => {
    const pause = vi.fn();
    const dispose = vi.fn();
    const element = { pause, srcObject: {} as MediaStream };
    disposeRemoteVideoSurface(element, { dispose });
    expect(pause).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(element.srcObject).toBeNull();
  });
});
