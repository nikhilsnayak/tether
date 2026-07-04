// Desktop deep-link handoff. Desktop OSes have no App Links equivalent, so a
// shared https room link always lands in the browser first; from there we fire
// the tether:// scheme and let the browser's own "Open Tether?" prompt (with
// its "always allow" option) handle the launch — no UI of our own.
const DESKTOP_APP_SCHEME = 'tether';

// Mobile devices open room links through native app links, so the desktop
// handoff never applies there.
const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile/i;

export function desktopRoomUrl(roomId: string): string {
  return `${DESKTOP_APP_SCHEME}://room/${encodeURIComponent(roomId)}`;
}

/** True only in a desktop web browser — not the Electron app, not mobile. */
export function canOfferDesktopApp(): boolean {
  if (typeof window === 'undefined') return false;
  const { protocol } = window.location;
  if (protocol !== 'http:' && protocol !== 'https:') return false; // Electron loads file://
  if ('tether' in window) return false; // already inside the desktop app
  return !MOBILE_UA.test(navigator.userAgent);
}
