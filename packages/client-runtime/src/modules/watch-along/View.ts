import type { WatchEvent, WatchSessionView } from './Model';

export const initialWatchSessionView: WatchSessionView = {
  status: 'unavailable',
  role: null,
  progress: 0,
  revision: 0,
  controlsEnabled: false,
  canPresent: false,
  bufferingReason: null,
};

// The actor projects a complete session snapshot on every change, so the UI
// reducer only adopts it. Availability, live stream handles, and transient
// failures drive dedicated atoms and leave the serializable view untouched.
export const reduceWatchView = (view: WatchSessionView, event: WatchEvent): WatchSessionView => {
  switch (event._tag) {
    case 'WatchSessionChanged':
      return event.view;
    case 'WatchAvailabilityChanged':
    case 'WatchProgramStreamReady':
    case 'WatchProgramStreamCleared':
    case 'WatchFailed':
      return view;
  }
};

export type { WatchEvent, WatchSessionView };
