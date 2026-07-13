import { useEffect, useRef, useState } from 'react';

import {
  applyMediaSettings,
  DEFAULT_MEDIA_SETTINGS,
  stopMediaStream,
  type InitialMediaSettings,
} from './media';

export type MediaPreflightStatus = 'idle' | 'acquiring' | 'ready' | 'failed';

export function useMediaPreflight() {
  const [status, setStatus] = useState<MediaPreflightStatus>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [settings, setSettings] = useState<InitialMediaSettings>(DEFAULT_MEDIA_SETTINGS);
  const [error, setError] = useState<unknown>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestGenerationRef = useRef(0);

  const release = () => {
    requestGenerationRef.current += 1;
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    setStream(null);
  };

  const acquire = async () => {
    release();
    const requestGeneration = requestGenerationRef.current;
    setStatus('acquiring');
    setError(null);
    try {
      const next = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (requestGeneration !== requestGenerationRef.current) {
        stopMediaStream(next);
        return;
      }
      applyMediaSettings(next, settings);
      streamRef.current = next;
      setStream(next);
      setStatus('ready');
    } catch (cause) {
      if (requestGeneration !== requestGenerationRef.current) return;
      setError(cause);
      setStatus('failed');
    }
  };

  const updateSettings = (next: InitialMediaSettings) => {
    setSettings(next);
    if (streamRef.current !== null) applyMediaSettings(streamRef.current, next);
  };

  useEffect(
    () => () => {
      requestGenerationRef.current += 1;
      stopMediaStream(streamRef.current);
      streamRef.current = null;
    },
    [],
  );

  return { status, stream, settings, error, acquire, release, updateSettings } as const;
}
