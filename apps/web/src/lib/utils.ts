import { generatePeerId as generatePeerIdEffect } from '@tether/client-runtime/modules/room';

import { webRuntime } from '@/lib/runtime';

export { formatRoomCodeInput, ROOM_CODE_LENGTH } from '@tether/client-runtime/modules/room';

// The peer identity is needed synchronously in render and handlers; randomBytes
// is synchronous on this platform, so runSync cannot block.
export const generatePeerId = () => webRuntime.runSync(generatePeerIdEffect);
