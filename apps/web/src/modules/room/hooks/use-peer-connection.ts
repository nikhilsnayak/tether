/** React lifecycle adapter for a scoped peer session. */

import { Effect, Fiber } from 'effect';
import { useEffect } from 'react';

import { appRuntime } from '@/lib/runtime';

import { runPeerSession } from '../peer-session';
import type { RoomSession } from '../types';

/** Mounts one peer session and interrupts all scoped resources on unmount. */
export function usePeerConnection({ input }: { input: RoomSession }) {
  const { roomId, selfId } = input;

  useEffect(() => {
    const fiber = appRuntime.runFork(Effect.scoped(runPeerSession({ roomId, selfId })));

    return () => {
      void Effect.runPromise(Fiber.interrupt(fiber));
    };
  }, [roomId, selfId]);
}
