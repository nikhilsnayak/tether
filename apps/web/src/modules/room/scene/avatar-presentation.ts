import type { RoomSession } from '@tether/client-runtime/modules/peer-session';

import type { RoomJourneyCue } from './journey';

export type AvatarPresence = 'absent' | 'present' | 'reconnecting';

export interface AvatarPresentation {
  readonly local: AvatarPresence;
  readonly localLocation: 'inside' | 'outside';
  readonly remote: AvatarPresence;
}

export const avatarPresentation = (
  intent: RoomSession['intent'],
  journey: RoomJourneyCue,
): AvatarPresentation => {
  // A guest is only ever inside once admitted; 'outside' (awaiting/declined
  // knock) and 'ended' (denied, expired, or a terminated call) both keep them
  // out, so a declined knock never drives the avatar into the room.
  const guestOutside = journey === 'outside' || journey === 'ended';
  const localLocation = intent === 'join' && guestOutside ? 'outside' : 'inside';
  if (journey === 'together') return { local: 'present', localLocation, remote: 'present' };
  if (journey === 'reconnecting') {
    return { local: 'present', localLocation, remote: 'reconnecting' };
  }
  return { local: 'present', localLocation, remote: 'absent' };
};
