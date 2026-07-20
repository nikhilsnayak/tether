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

export function useAvatarControls(
  enabled: boolean,
  consoleFocus?: {
    readonly inRange: boolean;
    readonly focused: boolean;
    readonly enter: () => void;
    readonly exit: () => void;
  },
) {
  const heldKeys = useHeldKeys();
  const [heldControls, setHeldControls] = useState<ReadonlySet<AvatarControl>>(new Set());
  const recenterSignal = useRef(0);
  const movementEnabled = enabled && consoleFocus?.focused !== true;
  const keyboardIgnored = shouldIgnoreKeyboardTarget(document.activeElement);
  const activeKeys = movementEnabled && !keyboardIgnored ? new Set(heldKeys) : new Set<string>();
  const input: AvatarInputIntent = movementEnabled
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
      enabled: movementEnabled,
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
      enabled: movementEnabled,
      ignoreInputs: false,
      preventDefault: false,
      requireReset: true,
      stopPropagation: false,
      meta: { name: 'Recenter camera', description: 'Recenter the camera behind your avatar' },
    },
  );
  useHotkey(
    'Enter',
    (event) => {
      if (shouldIgnoreKeyboardTarget(event.target)) return;
      event.preventDefault();
      if (consoleFocus?.focused === true) consoleFocus.exit();
      else if (consoleFocus?.inRange === true) consoleFocus.enter();
    },
    {
      enabled: enabled && (consoleFocus?.focused === true || consoleFocus?.inRange === true),
      ignoreInputs: false,
      preventDefault: false,
      requireReset: true,
      stopPropagation: false,
      meta: {
        name: 'Use watch console',
        description: 'Enter or exit local watch-console focus',
      },
    },
  );

  return { input, recenter, recenterSignal, setControlHeld };
}
