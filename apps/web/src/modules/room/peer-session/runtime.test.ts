import type { PreparedMedia, RoomSession } from '@tether/client-runtime/modules/room';
import { makePeerSessionControllerBinding } from '@tether/client-runtime/modules/room';
import { assert, describe, it } from 'vitest';

import { peerSessionAtom } from './runtime';

const session = {
  intent: 'host',
  selfId: 'aaaaaaaaaaaa',
  roomTemplateId: 'dusk-suite',
} as unknown as RoomSession;

// The family keys structurally, and every real transfer mints a fresh `claim`
// effect, so a fresh selection is always a distinct key. The `id` here stands in
// for that per-selection identity.
const preparedMedia = (id: string) => ({ id }) as unknown as PreparedMedia;

describe('peer session atom family', () => {
  it('returns the same atom for the same key', () => {
    const binding = makePeerSessionControllerBinding();
    const key = { session, preparedMedia: preparedMedia('same'), binding };
    assert.strictEqual(peerSessionAtom(key), peerSessionAtom(key));
  });

  it('returns distinct atoms for distinct prepared media', () => {
    const binding = makePeerSessionControllerBinding();
    const first = peerSessionAtom({ session, preparedMedia: preparedMedia('first'), binding });
    const second = peerSessionAtom({ session, preparedMedia: preparedMedia('second'), binding });
    assert.notStrictEqual(first, second);
  });
});
