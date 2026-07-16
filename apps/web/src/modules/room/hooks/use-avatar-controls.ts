import { useHeldKeys, useHotkey, useHotkeys } from '@tanstack/react-hotkeys';
import { useRef, useState } from 'react';

import { EMPTY_AVATAR_INPUT, type AvatarInputIntent } from '../scene/avatar-motion';

export type AvatarControl = 'forward' | 'backward' | 'left' | 'right';

const MOVEMENT_HOTKEYS = [
  'W',
  'ArrowUp',
  'S',
  'ArrowDown',
  'A',
  'ArrowLeft',
  'D',
  'ArrowRight',
] as const;

const shouldIgnoreKeyboardTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]') !== null;

export function useAvatarControls(enabled: boolean) {
  const heldKeys = useHeldKeys();
  const [heldControls, setHeldControls] = useState<ReadonlySet<AvatarControl>>(new Set());
  const recenterSignal = useRef(0);
  const keyboardIgnored =
    typeof document !== 'undefined' && shouldIgnoreKeyboardTarget(document.activeElement);
  const activeKeys = enabled && !keyboardIgnored ? new Set(heldKeys) : new Set<string>();
  const input: AvatarInputIntent = enabled
    ? {
        forward:
          Number(heldControls.has('forward') || activeKeys.has('W') || activeKeys.has('ArrowUp')) -
          Number(
            heldControls.has('backward') || activeKeys.has('S') || activeKeys.has('ArrowDown'),
          ),
        turn:
          Number(heldControls.has('left') || activeKeys.has('A') || activeKeys.has('ArrowLeft')) -
          Number(heldControls.has('right') || activeKeys.has('D') || activeKeys.has('ArrowRight')),
      }
    : EMPTY_AVATAR_INPUT;
  const setControlHeld = (control: AvatarControl, held: boolean) => {
    setHeldControls((current) => {
      const next = new Set(current);
      if (held) next.add(control);
      else next.delete(control);
      return next;
    });
  };
  const recenter = () => {
    recenterSignal.current += 1;
  };

  useHotkeys(
    MOVEMENT_HOTKEYS.map((hotkey) => ({
      hotkey,
      callback: (event: KeyboardEvent) => {
        if (!shouldIgnoreKeyboardTarget(event.target)) event.preventDefault();
      },
      options: {
        meta: { name: 'Move avatar', description: 'Move or turn your room avatar' },
      },
    })),
    {
      enabled,
      ignoreInputs: false,
      preventDefault: false,
      stopPropagation: false,
    },
  );
  useHotkey(
    'R',
    (event) => {
      if (shouldIgnoreKeyboardTarget(event.target)) return;
      event.preventDefault();
      recenter();
    },
    {
      enabled,
      ignoreInputs: false,
      preventDefault: false,
      requireReset: true,
      stopPropagation: false,
      meta: { name: 'Recenter camera', description: 'Recenter the camera behind your avatar' },
    },
  );

  return { input, recenter, recenterSignal, setControlHeld };
}
