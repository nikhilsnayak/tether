import { assert, describe, it } from '@effect/vitest';
import { afterEach, vi } from 'vitest';

import { canOfferDesktopApp, desktopRoomUrl } from './desktop-handoff';

const stubBrowser = (protocol: string, userAgent: string, extra: Record<string, unknown> = {}) => {
  vi.stubGlobal('window', { location: { protocol }, ...extra });
  vi.stubGlobal('navigator', { userAgent });
};

describe('desktopRoomUrl', () => {
  it('builds a tether-scheme URL with an encoded room id', () => {
    assert.strictEqual(desktopRoomUrl('AB CD'), 'tether://room/AB%20CD');
  });
});

describe('canOfferDesktopApp', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns false without a window (SSR / node)', () => {
    assert.isFalse(canOfferDesktopApp());
  });

  it('returns true in a desktop web browser', () => {
    stubBrowser('https:', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    assert.isTrue(canOfferDesktopApp());
  });

  it('returns false under a non-http protocol (Electron file://)', () => {
    stubBrowser('file:', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    assert.isFalse(canOfferDesktopApp());
  });

  it('returns false inside the desktop app', () => {
    stubBrowser('https:', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', { tether: {} });
    assert.isFalse(canOfferDesktopApp());
  });

  it('returns false on mobile browsers', () => {
    stubBrowser('https:', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    assert.isFalse(canOfferDesktopApp());
  });
});
