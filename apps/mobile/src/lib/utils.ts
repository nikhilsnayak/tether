import {
  generatePeerId as generatePeerIdEffect,
  generateRoomId as generateRoomIdEffect,
} from '@tether/client-runtime/modules/room';

import { nativeRuntime } from '@/lib/runtime';

export { formatRoomCodeInput, ROOM_CODE_LENGTH } from '@tether/client-runtime/modules/room';

// Codes are needed synchronously in render and handlers; randomBytes is
// synchronous on this platform, so runSync cannot block.
export const generateRoomId = () => nativeRuntime.runSync(generateRoomIdEffect);

export const generatePeerId = () => nativeRuntime.runSync(generatePeerIdEffect);
