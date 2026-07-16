import {
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';

import { seededStorageState } from '../storage-seed';
import { installWebRtcProbe, WebRtcProbe } from './webrtc-probe';

export type RoomActor = {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly probe?: WebRtcProbe;
};

export type ProbedRoomActor = RoomActor & { readonly probe: WebRtcProbe };

// Runs while an actor sits at the media-setup threshold, before the transfer
// click that requests a session. Lets a test observe the pre-session scene.
type ThresholdHook = (actor: RoomActor) => Promise<void>;

type ActorOptions = {
  readonly probeWebRtc?: boolean;
  readonly storageState?: BrowserContextOptions['storageState'];
};

type ConnectOptions = {
  readonly confirmSafety?: boolean;
  readonly probeWebRtc?: boolean;
};

type ConnectedRoom = {
  readonly guest: RoomActor;
  readonly host: RoomActor;
  readonly roomId: string;
};

type ProbedConnectedRoom = {
  readonly guest: ProbedRoomActor;
  readonly host: ProbedRoomActor;
  readonly roomId: string;
};

export class RoomDriver {
  readonly #contexts: BrowserContext[] = [];

  constructor(
    readonly browser: Browser,
    readonly baseURL: string,
  ) {}

  actorFor(page: Page): RoomActor;
  actorFor(page: Page, options: { readonly probeWebRtc: true }): Promise<ProbedRoomActor>;
  actorFor(page: Page, options?: { readonly probeWebRtc?: boolean }) {
    if (options?.probeWebRtc !== true) {
      return { context: page.context(), page };
    }
    return installWebRtcProbe(page.context()).then(() => ({
      context: page.context(),
      page,
      probe: new WebRtcProbe(page),
    }));
  }

  async close() {
    const errors: unknown[] = [];
    for (const context of this.#contexts.splice(0).reverse()) {
      try {
        await context.close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Failed to close one or more room actor contexts');
    }
  }

  async completeMediaSetup(actor: RoomActor, actionLabel: string, atThreshold?: ThresholdHook) {
    await this.prepareMediaSetup(actor);
    await atThreshold?.(actor);
    await actor.page.getByRole('button', { name: actionLabel, exact: true }).click();
  }

  connect(options: ConnectOptions & { readonly probeWebRtc: true }): Promise<ProbedConnectedRoom>;
  connect(options?: ConnectOptions): Promise<ConnectedRoom>;
  async connect(options: ConnectOptions = {}): Promise<ConnectedRoom> {
    const host = options.probeWebRtc
      ? await this.createActor({ probeWebRtc: true })
      : await this.createActor();
    const guest = options.probeWebRtc
      ? await this.createActor({ probeWebRtc: true })
      : await this.createActor();
    const roomId = await this.createRoom(host);
    await this.join(guest, roomId);
    await this.admit(host);
    await Promise.all([this.expectConnected(host), this.expectConnected(guest)]);
    if (options.confirmSafety !== false) {
      await Promise.all([
        host.page.getByRole('button', { name: 'We see the same code' }).click(),
        guest.page.getByRole('button', { name: 'We see the same code' }).click(),
      ]);
    }
    return { host, guest, roomId };
  }

  createActor(options: ActorOptions & { readonly probeWebRtc: true }): Promise<ProbedRoomActor>;
  createActor(options?: ActorOptions): Promise<RoomActor>;
  async createActor(options: ActorOptions = {}): Promise<RoomActor> {
    const context = await this.browser.newContext({
      baseURL: this.baseURL,
      storageState: options.storageState ?? seededStorageState,
    });
    this.#contexts.push(context);
    if (options.probeWebRtc) await installWebRtcProbe(context);
    const page = await context.newPage();
    return {
      context,
      page,
      probe: options.probeWebRtc ? new WebRtcProbe(page) : undefined,
    };
  }

  async createRoom(actor: RoomActor, atThreshold?: ThresholdHook) {
    const { page } = actor;
    await page.goto('/');
    await page.getByRole('button', { name: 'Call' }).click();
    await expect(page).toHaveURL(/\/host$/);
    await this.startHostingRoom(actor, atThreshold);
    const inviteLink = page.getByRole('textbox', { name: 'Room invite link' });
    await expect(inviteLink).toBeVisible({ timeout: 20_000 });
    const url = await inviteLink.inputValue();
    const roomId = url.split('/').at(-1);
    if (roomId === undefined || roomId === '') {
      throw new Error('Expected the invite link to contain a room id');
    }
    await page.getByRole('button', { name: 'Close' }).click();
    await this.expectWaitingForPeer(actor);
    return decodeURIComponent(roomId);
  }

  deny(actor: RoomActor) {
    return actor.page.getByRole('button', { name: 'Keep out', exact: true }).click();
  }

  expectConnected(actor: RoomActor) {
    return expect(actor.page.getByText('Connected', { exact: true }).first()).toBeVisible({
      timeout: 35_000,
    });
  }

  expectPeerDeparted(actor: RoomActor) {
    return Promise.all([
      expect(
        actor.page.getByText('They left the call. You can wait here in case they rejoin.'),
      ).toBeVisible(),
      expect(actor.page.getByLabel('Dusk Suite room scene')).toHaveAttribute(
        'data-room-journey',
        'waiting',
      ),
    ]);
  }

  expectPreparedMediaTransferred(actor: ProbedRoomActor) {
    return expect
      .poll(() => actor.probe.preparedMediaState())
      .toEqual({
        acquiredStreams: 1,
        actorUsesPreview: true,
        previewWasAcquired: true,
        streamIsLive: true,
      });
  }

  expectWaitingForPeer(actor: RoomActor) {
    return Promise.all([
      expect(actor.page.getByText('Share this room to invite someone.')).toBeVisible(),
      expect(actor.page.getByLabel('Dusk Suite room scene')).toHaveAttribute(
        'data-room-journey',
        'waiting',
      ),
    ]);
  }

  admit(actor: RoomActor) {
    return actor.page.getByRole('button', { name: 'Let in', exact: true }).click();
  }

  async join(actor: RoomActor, roomId: string, displayName = 'Guest', atThreshold?: ThresholdHook) {
    await this.prepareGuestAtThreshold(actor, roomId, displayName);
    await atThreshold?.(actor);
    await actor.page.getByRole('button', { name: 'Knock on door', exact: true }).click();
  }

  newPage(actor: ProbedRoomActor): Promise<ProbedRoomActor>;
  newPage(actor: RoomActor): Promise<RoomActor>;
  async newPage(actor: RoomActor): Promise<RoomActor> {
    const page = await actor.context.newPage();
    return {
      context: actor.context,
      page,
      probe: actor.probe === undefined ? undefined : new WebRtcProbe(page),
    };
  }

  async prepareGuestAtThreshold(actor: RoomActor, roomId: string, displayName = 'Guest') {
    const { page } = actor;
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Room code' }).fill(roomId);
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page).toHaveURL(new RegExp(`/room/${roomId}$`));
    await page.getByRole('button', { name: 'Join in this browser' }).click();
    await page.getByRole('textbox', { name: 'Your name' }).fill(displayName);
    await page.getByRole('button', { name: 'Continue to media check' }).click();
    await this.prepareMediaSetup(actor);
  }

  async prepareMediaSetup(actor: RoomActor) {
    const { page } = actor;
    await expect(page.getByRole('heading', { name: 'Look and sound ready?' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByLabel('Camera preview')).toBeVisible();
    if (actor.probe !== undefined) await actor.probe.rememberPreviewStream();
  }

  startHostingRoom(actor: RoomActor, atThreshold?: ThresholdHook) {
    return this.completeMediaSetup(actor, 'Invite someone', atThreshold);
  }
}
