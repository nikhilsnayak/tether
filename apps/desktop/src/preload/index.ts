import { contextBridge, ipcRenderer } from 'electron';

/** Minimal, explicit surface exposed to the renderer under `window.tether`. */
const api = {
  platform: process.platform,
  /** Signals that the renderer installed its deep-link listener. */
  ready: () => ipcRenderer.send('renderer-ready'),
  /** Subscribe to `tether://room/<id>` deep links. Returns an unsubscribe fn. */
  onOpenRoom: (callback: (roomId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, roomId: string) => callback(roomId);
    ipcRenderer.on('open-room', listener);
    return () => ipcRenderer.removeListener('open-room', listener);
  },
};

contextBridge.exposeInMainWorld('tether', api);

export type TetherApi = typeof api;
