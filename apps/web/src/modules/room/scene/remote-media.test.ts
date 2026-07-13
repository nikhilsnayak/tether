import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  containedVideoSize,
  createRemoteVideoSurface,
  disposeRemoteVideoSurface,
} from './remote-media';

describe('containedVideoSize', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('letterboxes portrait video without cropping', () => {
    expect(containedVideoSize(1080, 1920, 16, 9)).toEqual([5.0625, 9]);
  });

  it('pillarboxes extra-wide video without cropping', () => {
    expect(containedVideoSize(2560, 1080, 16, 9)).toEqual([16, 6.75]);
  });

  it('fills a matching display', () => {
    expect(containedVideoSize(1920, 1080, 16, 9)).toEqual([16, 9]);
  });

  it('fills the display when source dimensions are unavailable', () => {
    expect(containedVideoSize(0, 0, 16, 9)).toEqual([16, 9]);
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

  it('creates, starts, and disposes a remote video surface', () => {
    const play = vi.fn(async () => undefined);
    const pause = vi.fn();
    const video = { play, pause, srcObject: null };
    vi.stubGlobal('document', { createElement: vi.fn(() => video) });

    const stream = {} as MediaStream;
    const surface = createRemoteVideoSurface(stream);
    expect(surface.element).toBe(video);
    expect(video.srcObject).toBe(stream);
    expect(play).toHaveBeenCalledOnce();

    surface.dispose();
    expect(pause).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
  });

  it('tolerates browsers rejecting video autoplay', async () => {
    const video = {
      play: vi.fn(() => Promise.reject(new Error('autoplay blocked'))),
      pause: vi.fn(),
      srcObject: null,
    };
    vi.stubGlobal('document', { createElement: vi.fn(() => video) });

    const surface = createRemoteVideoSurface({} as MediaStream);
    await Promise.resolve();
    surface.dispose();

    expect(video.play).toHaveBeenCalledOnce();
  });
});
