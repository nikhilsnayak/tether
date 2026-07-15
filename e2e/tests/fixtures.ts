import { expect, test as base } from '@playwright/test';

import { RoomDriver } from './support/room-driver';

type Fixtures = {
  readonly room: RoomDriver;
};

export const test = base.extend<Fixtures>({
  room: async ({ baseURL, browser }, use) => {
    if (typeof baseURL !== 'string') {
      throw new TypeError('This E2E test requires a configured baseURL');
    }
    const room = new RoomDriver(browser, baseURL);
    try {
      await use(room);
    } finally {
      await room.close();
    }
  },
});

export { expect };
export type { BrowserContext, Page } from '@playwright/test';
export type { ProbedRoomActor, RoomActor } from './support/room-driver';
