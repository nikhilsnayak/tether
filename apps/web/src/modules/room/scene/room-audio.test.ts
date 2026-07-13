import { describe, expect, it, vi } from 'vitest';

import { disposeRoomAudioResources, selectRemoteAudioRoute } from './room-audio';

describe('room audio routing', () => {
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
});
