import { useEffect } from 'react';

export function useScreenWakeLock() {
  useEffect(() => {
    let disposed = false;
    let acquiring = false;
    let wakeLock: WakeLockSentinel | null = null;

    const acquireWakeLock = async () => {
      if (acquiring || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) {
        return;
      }

      acquiring = true;
      try {
        const acquiredWakeLock = await navigator.wakeLock.request('screen');
        if (disposed) {
          await acquiredWakeLock.release();
          return;
        }
        wakeLock = acquiredWakeLock;
      } catch {
        // Wake lock is an enhancement; calls still work when the browser or OS denies it.
      } finally {
        acquiring = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && wakeLock?.released !== false) {
        void acquireWakeLock();
      }
    };

    void acquireWakeLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      void wakeLock?.release();
    };
  }, []);
}
