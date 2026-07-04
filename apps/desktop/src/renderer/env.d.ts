/// <reference types="vite/client" />

import type { TetherApi } from '../preload';

declare global {
  interface Window {
    tether?: TetherApi;
  }
}

export {};
