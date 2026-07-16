import { isPlatformError } from '@tether/client-runtime/modules/peer-session';
import { Effect } from 'effect';
import { useEffect, useRef, useState } from 'react';

import { prepareLocalMedia, type PreparedLocalMedia } from '../peer-session/platform';
import {
  applyMediaSettings,
  DEFAULT_MEDIA_SETTINGS,
  type InitialMediaSettings,
  type PreparedMediaSelection,
} from './media';

export type MediaPreflightStatus = 'idle' | 'acquiring' | 'ready' | 'failed';

export function useMediaPreflight() {
  const [status, setStatus] = useState<MediaPreflightStatus>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [settings, setSettings] = useState<InitialMediaSettings>(DEFAULT_MEDIA_SETTINGS);
  const [error, setError] = useState<unknown>(null);
  const preparedMediaRef = useRef<PreparedLocalMedia | null>(null);
  const requestGenerationRef = useRef(0);

  const release = () => {
    requestGenerationRef.current += 1;
    void preparedMediaRef.current?.cancel();
    preparedMediaRef.current = null;
    setStream(null);
  };

  const acquire = async () => {
    release();
    const requestGeneration = requestGenerationRef.current;
    setStatus('acquiring');
    setError(null);
    try {
      const next = await Effect.runPromise(prepareLocalMedia());
      if (requestGeneration !== requestGenerationRef.current) {
        await next.cancel();
        return;
      }
      applyMediaSettings(next.stream, settings);
      preparedMediaRef.current = next;
      setStream(next.stream);
      setStatus('ready');
    } catch (cause) {
      if (requestGeneration !== requestGenerationRef.current) return;
      setError(isPlatformError(cause) ? cause.cause : cause);
      setStatus('failed');
    }
  };

  const updateSettings = (next: InitialMediaSettings) => {
    setSettings(next);
    if (preparedMediaRef.current !== null)
      applyMediaSettings(preparedMediaRef.current.stream, next);
  };

  const transfer = (): PreparedMediaSelection => {
    const preparedMedia = preparedMediaRef.current;
    if (preparedMedia === null) throw new Error('Local media is not ready');
    const claimedMedia = preparedMedia.transfer();
    preparedMediaRef.current = null;
    return {
      media: {
        ...claimedMedia,
        initialState: {
          cameraOn: settings.camera,
          microphoneOn: settings.microphone,
        },
      },
      settings,
      release: preparedMedia.cancel,
    };
  };

  useEffect(
    () => () => {
      requestGenerationRef.current += 1;
      void preparedMediaRef.current?.cancel();
      preparedMediaRef.current = null;
    },
    [],
  );

  return { status, stream, settings, error, acquire, release, transfer, updateSettings } as const;
}
