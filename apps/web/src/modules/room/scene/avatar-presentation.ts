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
  const localLocation = intent === 'join' && journey === 'outside' ? 'outside' : 'inside';
  if (journey === 'together') return { local: 'present', localLocation, remote: 'present' };
  if (journey === 'reconnecting') {
    return { local: 'present', localLocation, remote: 'reconnecting' };
  }
  return { local: 'present', localLocation, remote: 'absent' };
};
