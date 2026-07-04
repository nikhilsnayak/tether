/**
 * Dev orchestrator for the desktop client (plain Vite + tsc + Electron).
 *
 *   1. tsc --watch  → recompile main/preload to dist/ on change
 *   2. vite         → renderer dev server (HMR)
 *   3. wait for the dev-server port AND the compiled main/preload to exist
 *   4. launch Electron; watch dist/main + dist/preload and restart it on change
 *
 * The wait-for-resources step and the watch-and-restart loop are adapted from
 * t3code's apps/desktop/scripts/dev-electron.mjs (MIT).
 * Source: https://github.com/pingdotgg/t3code
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { access, watch } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const HOST = 'localhost';
const PORT = 5273;
const DEV_URL = `http://${HOST}:${PORT}`;
const RESTART_DEBOUNCE_MS = 150;
const FORCE_KILL_TIMEOUT_MS = 1_500;
// Give up if Electron keeps crashing on launch (e.g. a broken main process)
// instead of respawning forever.
const FAST_CRASH_WINDOW_MS = 1_500;
const MAX_FAST_CRASHES = 3;

const MAIN_OUTPUT = 'dist/main/index.js';
const PRELOAD_OUTPUT = 'dist/preload/index.js';
// The `electron` package resolves to the absolute path of the binary, so we
// don't depend on it being on PATH.
const electronPath = createRequire(import.meta.url)('electron') as string;

const children = new Set<ChildProcess>();

function run(command: string, args: ReadonlyArray<string>): ChildProcess {
  const child = spawn(command, args, { stdio: 'inherit' });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

async function waitForPort(retries = 300): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const reachable = await new Promise<boolean>((resolve) => {
      const socket = net.connect(PORT, HOST);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (reachable) return;
    await delay(100);
  }
  throw new Error(`Vite dev server did not open on ${DEV_URL}`);
}

async function waitForFile(path: string, retries = 300): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await access(path);
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

let electron: ChildProcess | null = null;
let expectedExit = false;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let shuttingDown = false;
let recentCrashes = 0;

function startElectron() {
  if (shuttingDown) return;

  const startedAt = Date.now();
  const child = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: DEV_URL },
  });
  electron = child;
  expectedExit = false;

  child.once('exit', (code, signal) => {
    if (electron === child) electron = null;
    if (shuttingDown || expectedExit) return;

    // Closing the window is a normal quit → tear the whole dev session down.
    if (code === 0 && signal === null) {
      void shutdown(0);
      return;
    }

    if (Date.now() - startedAt < FAST_CRASH_WINDOW_MS) {
      recentCrashes += 1;
      if (recentCrashes >= MAX_FAST_CRASHES) {
        console.error(`\n[dev] Electron crashed ${recentCrashes} times on launch — stopping.`);
        void shutdown(1);
        return;
      }
    } else {
      recentCrashes = 0;
    }
    startElectron();
  });
}

async function stopElectron(): Promise<void> {
  const child = electron;
  if (!child) return;
  electron = null;
  expectedExit = true;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once('exit', finish);
    child.kill('SIGTERM');
    setTimeout(() => {
      child.kill('SIGKILL');
      finish();
    }, FORCE_KILL_TIMEOUT_MS).unref();
  });
}

function scheduleRestart() {
  if (shuttingDown) return;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void (async () => {
      await stopElectron();
      startElectron();
    })();
  }, RESTART_DEBOUNCE_MS);
}

async function watchMainProcess() {
  // A single recursive watch over dist/ covers both main and preload output.
  const watcher = watch('dist', { recursive: true });
  for await (const event of watcher) {
    if (shuttingDown) break;
    if (event.filename?.startsWith('main') || event.filename?.startsWith('preload')) {
      scheduleRestart();
    }
  }
}

async function shutdown(exitCode: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (restartTimer) clearTimeout(restartTimer);
  await stopElectron();
  for (const child of children) child.kill('SIGTERM');
  process.exit(exitCode);
}

process.once('SIGINT', () => void shutdown(130));
process.once('SIGTERM', () => void shutdown(143));

run('tsc', ['-p', 'tsconfig.electron.json', '--watch', '--preserveWatchOutput']);
run('vite', []);

await waitForPort();
await waitForFile(MAIN_OUTPUT);
await waitForFile(PRELOAD_OUTPUT);

startElectron();
void watchMainProcess();
