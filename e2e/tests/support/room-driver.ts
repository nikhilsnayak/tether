import {
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';

import { seededStorageState } from '../storage-seed';
import { installWebRtcProbe, WebRtcProbe } from './webrtc-probe';

const REAL_MEDIA_READY_TIMEOUT = 30_000;
type WatchState =
  | 'unavailable'
  | 'idle'
  | 'preparing-local'
  | 'awaiting-remote-start'
  | 'loaded-paused'
  | 'playing'
  | 'ended';

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

type TrackedServerSocket = {
  readonly url: string;
  closed: boolean;
};

export class RoomDriver {
  readonly #contexts: BrowserContext[] = [];
  readonly #serverSockets = new Map<Page, TrackedServerSocket[]>();

  constructor(
    readonly browser: Browser,
    readonly baseURL: string,
  ) {}

  actorFor(page: Page): RoomActor;
  actorFor(page: Page, options: { readonly probeWebRtc: true }): Promise<ProbedRoomActor>;
  actorFor(page: Page, options?: { readonly probeWebRtc?: boolean }) {
    this.#trackServerSockets(page);
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
    this.#trackServerSockets(page);
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

  expectDetached(actor: RoomActor) {
    return expect(actor.page.locator('[data-detached="true"]')).toBeAttached({
      timeout: 15_000,
    });
  }

  async expectZeroServerSockets(actor: RoomActor) {
    const sockets = this.#serverSockets.get(actor.page) ?? [];
    await expect
      .poll(() => ({ count: sockets.length, allClosed: sockets.every((socket) => socket.closed) }))
      .toEqual({ count: 1, allClosed: true });

    const closedCount = sockets.length;
    await actor.page.waitForTimeout(3_000);
    expect(sockets).toHaveLength(closedCount);
    expect(sockets.every((socket) => socket.closed)).toBe(true);
  }

  expectPeerDeparted(actor: RoomActor) {
    return Promise.all([
      expect(
        actor.page.getByText('This room has ended. Create a new room to talk again.'),
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

  expectRendererReady(actor: RoomActor) {
    const scene = actor.page.getByLabel('Dusk Suite room scene');
    return Promise.all([
      expect(scene).toHaveAttribute('data-room-renderer-ready', 'true', { timeout: 30_000 }),
      expect(scene).toHaveAttribute(
        'data-room-renderer-backend',
        process.env.CI ? 'webgl' : /^(webgpu|webgl)$/,
        { timeout: 30_000 },
      ),
    ]);
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

  expectWatchState(actor: RoomActor, state: WatchState) {
    return expect(actor.page.getByLabel('Dusk Suite room scene')).toHaveAttribute(
      'data-room-display',
      state,
      { timeout: 30_000 },
    );
  }

  async startWatch(actor: RoomActor) {
    const bytes = await actor.page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('Canvas 2D is unavailable');
      const stream = canvas.captureStream(24);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      const chunks: Blob[] = [];
      recorder.addEventListener('dataavailable', (event) => chunks.push(event.data));
      const stopped = new Promise<void>((resolve) =>
        recorder.addEventListener('stop', () => resolve(), { once: true }),
      );
      recorder.start();
      const startedAt = performance.now();
      await new Promise<void>((resolve) => {
        const draw = () => {
          const elapsed = performance.now() - startedAt;
          context.fillStyle = '#153e75';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = '#f59e0b';
          context.fillRect(0, 0, canvas.width / 2, canvas.height / 2);
          context.fillRect(
            canvas.width / 2,
            canvas.height / 2,
            canvas.width / 2,
            canvas.height / 2,
          );
          context.fillStyle = '#f8fafc';
          context.fillRect((elapsed / 8) % canvas.width, 0, 18, canvas.height);
          context.font = 'bold 32px sans-serif';
          context.fillText('WATCH', 94, 102);
          if (elapsed >= 2_000) resolve();
          else requestAnimationFrame(draw);
        };
        draw();
      });
      recorder.stop();
      await stopped;
      for (const track of stream.getTracks()) track.stop();
      return [...new Uint8Array(await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer())];
    });
    await actor.page.locator('[data-watch-file-input]').setInputFiles({
      name: 'watch-e2e.webm',
      mimeType: 'video/webm',
      buffer: Buffer.from(bytes),
    });
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
    this.#trackServerSockets(page);
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
    await expect(page.getByLabel('Camera preview')).toBeVisible({
      timeout: REAL_MEDIA_READY_TIMEOUT,
    });
    if (actor.probe !== undefined) await actor.probe.rememberPreviewStream();
  }

  startHostingRoom(actor: RoomActor, atThreshold?: ThresholdHook) {
    return this.completeMediaSetup(actor, 'Invite someone', atThreshold);
  }

  #trackServerSockets(page: Page) {
    if (this.#serverSockets.has(page)) return;
    const sockets: TrackedServerSocket[] = [];
    this.#serverSockets.set(page, sockets);
    page.on('websocket', (webSocket) => {
      const url = new URL(webSocket.url());
      if (url.pathname !== '/rpc/signaling') return;
      const socket: TrackedServerSocket = { url: webSocket.url(), closed: false };
      sockets.push(socket);
      webSocket.on('close', () => {
        socket.closed = true;
      });
    });
  }
}
