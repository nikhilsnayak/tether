/** React lifecycle adapter for a scoped peer session. */

import { RegistryContext } from '@effect/atom-react';
import { Effect, Fiber, Queue } from 'effect';
import { AtomRegistry } from 'effect/unstable/reactivity';
import { use, useEffect, useRef } from 'react';

import { appRuntime } from '@/lib/runtime';

import { runPeerSession } from '../peer-session';
import type { UiCommand } from '../peer-session/model';
import type { RoomSession } from '../types';

/** Mounts one peer session and interrupts all scoped resources on unmount. */
export function usePeerConnection({ input }: { input: RoomSession }) {
  const { roomId, selfId } = input;

  const registry = use(RegistryContext);
  const uiCommandQueueRef = useRef<Queue.Enqueue<UiCommand> | null>(null);

  useEffect(() => {
    const uiCommandQueue = Effect.runSync(Queue.unbounded<UiCommand>());
    uiCommandQueueRef.current = uiCommandQueue;

    const fiber = appRuntime.runFork(
      Effect.scoped(
        runPeerSession({ roomId, selfId }, uiCommandQueue).pipe(
          Effect.provideService(AtomRegistry.AtomRegistry, registry),
        ),
      ),
    );

    return () => {
      if (uiCommandQueueRef.current === uiCommandQueue) {
        uiCommandQueueRef.current = null;
      }
      void Effect.runPromise(Fiber.interrupt(fiber));
    };
  }, [roomId, selfId, registry]);

  const sendMessage = (message: string) => {
    const uiCommandQueue = uiCommandQueueRef.current;
    if (uiCommandQueue === null) {
      return false;
    }

    return Queue.offerUnsafe(uiCommandQueue, { _tag: 'SendMessage', message });
  };

  return { sendMessage };
}
