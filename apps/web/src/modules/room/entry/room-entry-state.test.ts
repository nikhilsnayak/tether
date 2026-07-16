import { assert, describe, it } from 'vitest';

import type { PreparedMediaSelection } from '../preflight/media';
import { initialRoomEntryState, roomEntryReducer, type RoomEntryState } from './room-entry-state';

const selection = {
  media: { id: 'prepared' },
  settings: { microphone: true, camera: true },
  release: () => Promise.resolve(),
} as unknown as PreparedMediaSelection;

const otherSelection = {
  media: { id: 'other' },
  settings: { microphone: false, camera: false },
  release: () => Promise.resolve(),
} as unknown as PreparedMediaSelection;

const requestedPreparedMedia = (state: RoomEntryState) =>
  (state as Extract<RoomEntryState, { _tag: 'SessionRequested' }>).preparedMedia;

describe('room entry state', () => {
  it('starts in media setup', () => {
    assert.deepStrictEqual(initialRoomEntryState, { _tag: 'MediaSetup' });
  });

  it('transfers the exact selection into session-requested', () => {
    const next = roomEntryReducer(initialRoomEntryState, {
      _tag: 'MediaPrepared',
      preparedMedia: selection,
    });
    assert.strictEqual(next._tag, 'SessionRequested');
    assert.strictEqual(
      (next as Extract<RoomEntryState, { _tag: 'SessionRequested' }>).preparedMedia,
      selection,
    );
  });

  it('restarts back to media setup without retaining a selection', () => {
    const requested = roomEntryReducer(initialRoomEntryState, {
      _tag: 'MediaPrepared',
      preparedMedia: selection,
    });
    assert.deepStrictEqual(roomEntryReducer(requested, { _tag: 'RestartMediaSetup' }), {
      _tag: 'MediaSetup',
    });
  });

  it('is idempotent when restarting from media setup', () => {
    assert.deepStrictEqual(roomEntryReducer(initialRoomEntryState, { _tag: 'RestartMediaSetup' }), {
      _tag: 'MediaSetup',
    });
  });

  it('ignores a second preparation and keeps the first linear resource', () => {
    const requested = roomEntryReducer(initialRoomEntryState, {
      _tag: 'MediaPrepared',
      preparedMedia: selection,
    });
    const again = roomEntryReducer(requested, {
      _tag: 'MediaPrepared',
      preparedMedia: otherSelection,
    });
    assert.strictEqual(again, requested);
    assert.strictEqual(requestedPreparedMedia(again), selection);
  });

  it('drops the failed selection and accepts a fresh one after restart', () => {
    const requested = roomEntryReducer(initialRoomEntryState, {
      _tag: 'MediaPrepared',
      preparedMedia: selection,
    });
    assert.strictEqual(requestedPreparedMedia(requested), selection);

    // A failed acquisition returns to media setup with no access to the old selection.
    const restarted = roomEntryReducer(requested, { _tag: 'RestartMediaSetup' });
    assert.deepStrictEqual(restarted, { _tag: 'MediaSetup' });

    // The next attempt claims a new object; the old selection is never re-observed.
    const reprepared = roomEntryReducer(restarted, {
      _tag: 'MediaPrepared',
      preparedMedia: otherSelection,
    });
    assert.strictEqual(requestedPreparedMedia(reprepared), otherSelection);
    assert.notStrictEqual(requestedPreparedMedia(reprepared), selection);
  });
});
