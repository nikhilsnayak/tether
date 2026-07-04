import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, ipcMain, session, shell } from 'electron';

const DEEP_LINK_SCHEME = 'tether';
const APP_ID = 'dev.nikhilsnayak.tether';
const LINUX_DESKTOP_NAME = `${APP_ID}.desktop`;
const PRODUCT_NAME = 'Tether';
const APP_ICON_PATH = app.isPackaged
  ? join(process.resourcesPath, 'icon.png')
  : resolve(__dirname, '../../build/icon.png');
const RENDERER_ENTRY_PATH = join(__dirname, '../renderer/index.html');
const ROOM_CODE_PATTERN = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

let mainWindow: BrowserWindow | null = null;
let pendingRoomId: string | null = null;
let rendererReady = false;

function isTrustedRendererUrl(url: string): boolean {
  try {
    const candidate = new URL(url);
    const devServerUrl = process.env['VITE_DEV_SERVER_URL'];

    if (devServerUrl !== undefined) {
      return candidate.origin === new URL(devServerUrl).origin;
    }

    return candidate.protocol === 'file:' && fileURLToPath(candidate) === RENDERER_ENTRY_PATH;
  } catch {
    return false;
  }
}

function isSafeExternalUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/** Parses `tether://room/<id>` into the room id, or null when it is not a room link. */
function extractRoomId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const pathSegments = parsed.pathname.split('/').filter(Boolean);
    if (
      parsed.protocol !== `${DEEP_LINK_SCHEME}:` ||
      parsed.hostname !== 'room' ||
      pathSegments.length !== 1 ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.port !== '' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      return null;
    }

    const roomId = decodeURIComponent(pathSegments[0]!);
    return ROOM_CODE_PATTERN.test(roomId) ? roomId : null;
  } catch {
    return null;
  }
}

function focusWindow() {
  if (mainWindow === null) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function handleDeepLink(url: string) {
  const roomId = extractRoomId(url);
  if (roomId === null) return;

  if (mainWindow === null || !rendererReady) {
    pendingRoomId = roomId;
    focusWindow();
    return;
  }

  focusWindow();
  mainWindow.webContents.send('open-room', roomId);
}

function createWindow() {
  rendererReady = false;
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#1c1d1f',
    icon: APP_ICON_PATH,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false;
  });

  mainWindow.webContents.on('will-frame-navigate', (event) => {
    if (!isTrustedRendererUrl(event.url)) {
      event.preventDefault();
    }
  });

  // Only ordinary web links may leave the app through the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell
        .openExternal(url)
        .catch((error: unknown) => console.error('[desktop] Failed to open external URL', error));
    }
    return { action: 'deny' };
  });

  const devServerUrl = process.env['VITE_DEV_SERVER_URL'];
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(RENDERER_ENTRY_PATH);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
  });
}

function registerProtocol() {
  if (process.defaultApp && process.argv.length >= 2) {
    // Dev: register the scheme against the electron binary and this script.
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [resolve(process.argv[1]!)]);
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  }
}

function isTrustedPermissionRequest(
  webContents: Electron.WebContents | null,
  permission: string,
  requestingUrl: string | undefined,
  isMainFrame: boolean,
) {
  return (
    permission === 'media' &&
    isMainFrame &&
    webContents !== null &&
    webContents === mainWindow?.webContents &&
    isTrustedRendererUrl(requestingUrl ?? webContents.getURL())
  );
}

function onReady() {
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) =>
    isTrustedPermissionRequest(webContents, permission, details.requestingUrl, details.isMainFrame),
  );
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        isTrustedPermissionRequest(
          webContents,
          permission,
          details.requestingUrl,
          details.isMainFrame,
        ),
      );
    },
  );
  registerProtocol();

  ipcMain.on('renderer-ready', (event) => {
    if (event.sender !== mainWindow?.webContents) return;

    rendererReady = true;
    if (pendingRoomId !== null) {
      mainWindow.webContents.send('open-room', pendingRoomId);
      pendingRoomId = null;
    }
  });

  // Windows/Linux cold-start deep link arrives in argv.
  const initialUrl = process.argv.find((arg) => arg.startsWith(`${DEEP_LINK_SCHEME}://`));
  if (initialUrl) handleDeepLink(initialUrl);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.setName(PRODUCT_NAME);
if (process.platform === 'linux') {
  app.setDesktopName(LINUX_DESKTOP_NAME);
}

// A single instance owns the window so deep links focus it rather than
// spawning a second process (Windows/Linux).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((arg) => arg.startsWith(`${DEEP_LINK_SCHEME}://`));
    if (url) handleDeepLink(url);
    else focusWindow();
  });

  // macOS delivers deep links through open-url.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  void app.whenReady().then(onReady);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
